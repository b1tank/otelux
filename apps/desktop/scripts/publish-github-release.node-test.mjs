import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { assetsAreComplete, publishGitHubRelease } from './publish-github-release.mjs';

const TARGET = 'a'.repeat(40);
const directories = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function assets() {
	const directory = mkdtempSync(join(tmpdir(), 'otelux-release-assets-'));
	directories.push(directory);
	const files = [
		['OTelux-0.1.2-amd64.deb', 'deb-content'],
		['SHA256SUMS', 'checksum-content'],
		['otelux-0.1.2-sbom.cdx.json', '{"bom":true}'],
	].map(([name, content]) => {
		const path = join(directory, name);
		writeFileSync(path, content);
		return { path, name, size: Buffer.byteLength(content) };
	});
	return files;
}

function response(body, status = 200) {
	return new Response(body === undefined ? undefined : JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function options(assetFiles) {
	return {
		repository: 'owner/repo',
		token: 'test-token',
		tag: 'v0.1.2',
		target: TARGET,
		title: 'OTelux v0.1.2',
		notes: 'release notes',
		assetPaths: assetFiles.map((asset) => asset.path),
	};
}

describe('publishGitHubRelease', () => {
	it('creates a tag and draft, uploads every asset, then publishes', async () => {
		const assetFiles = assets();
		let tagReads = 0;
		const calls = [];
		const fetchImpl = async (url, init = {}) => {
			calls.push({ url, method: init.method ?? 'GET', body: init.body });
			if (url.endsWith('/git/ref/tags/v0.1.2')) {
				tagReads++;
				return tagReads === 1
					? response({ message: 'Not Found' }, 404)
					: response({ object: { type: 'commit', sha: TARGET } });
			}
			if (url.endsWith('/git/refs')) {
				return response({ ref: 'refs/tags/v0.1.2' }, 201);
			}
			if (url.includes('/releases?')) {
				return response([]);
			}
			if (url.endsWith('/releases')) {
				return response(
					{
						id: 7,
						tag_name: 'v0.1.2',
						draft: true,
						assets: [],
						upload_url: 'https://uploads.github.com/releases/7/assets{?name,label}',
					},
					201,
				);
			}
			if (url.startsWith('https://uploads.github.com/')) {
				return response({ id: 10 }, 201);
			}
			if (url.endsWith('/releases/7')) {
				return response({ id: 7, draft: false });
			}
			throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${url}`);
		};

		const result = await publishGitHubRelease(options(assetFiles), fetchImpl);

		assert.deepEqual(result, { status: 'published', releaseId: 7, tag: 'v0.1.2' });
		assert.equal(calls.filter((call) => call.url.startsWith('https://uploads.')).length, 3);
		assert.equal(
			calls.some((call) => call.url.endsWith('/releases/7') && JSON.parse(call.body).draft === false),
			true,
		);
	});

	it('resumes a partial draft and replaces matching assets', async () => {
		const assetFiles = assets();
		const calls = [];
		const draft = {
			id: 8,
			tag_name: 'v0.1.2',
			draft: true,
			assets: [{ id: 22, name: assetFiles[0].name, size: 1 }],
			upload_url: 'https://uploads.github.com/releases/8/assets{?name,label}',
		};
		const fetchImpl = async (url, init = {}) => {
			calls.push({ url, method: init.method ?? 'GET', body: init.body });
			if (url.endsWith('/git/ref/tags/v0.1.2')) {
				return response({ object: { type: 'commit', sha: TARGET } });
			}
			if (url.includes('/releases?')) {
				return response([draft]);
			}
			if (url.endsWith('/releases/8') && init.method === 'PATCH') {
				return response({ ...draft, ...JSON.parse(init.body) });
			}
			if (url.endsWith('/releases/assets/22')) {
				return response(undefined, 204);
			}
			if (url.startsWith('https://uploads.github.com/')) {
				return response({ id: 30 }, 201);
			}
			throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${url}`);
		};

		const result = await publishGitHubRelease(options(assetFiles), fetchImpl);

		assert.equal(result.status, 'published');
		assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1);
		assert.equal(calls.filter((call) => call.url.startsWith('https://uploads.')).length, 3);
	});

	it('treats a complete matching published release as success', async () => {
		const assetFiles = assets();
		const fetchImpl = async (url) => {
			if (url.endsWith('/git/ref/tags/v0.1.2')) {
				return response({ object: { type: 'commit', sha: TARGET } });
			}
			if (url.includes('/releases?')) {
				return response([
					{
						id: 9,
						tag_name: 'v0.1.2',
						draft: false,
						assets: assetFiles.map((asset, index) => ({ id: index, state: 'uploaded', ...asset })),
					},
				]);
			}
			throw new Error(`Unexpected request: ${url}`);
		};

		assert.deepEqual(await publishGitHubRelease(options(assetFiles), fetchImpl), {
			status: 'already-published',
			releaseId: 9,
			tag: 'v0.1.2',
		});
	});

	it('refuses a tag that points at another commit', async () => {
		const assetFiles = assets();
		const fetchImpl = async () => response({ object: { type: 'commit', sha: 'b'.repeat(40) } });
		await assert.rejects(
			publishGitHubRelease(options(assetFiles), fetchImpl),
			/points at b+, expected a+/,
		);
	});
});

describe('assetsAreComplete', () => {
	it('requires every expected asset name and size', () => {
		assert.equal(
			assetsAreComplete(
				[{ name: 'a', size: 3 }],
				[
					{ name: 'a', size: 3 },
					{ name: 'b', size: 4 },
				],
			),
			false,
		);
		assert.equal(
			assetsAreComplete(
				[
					{ name: 'a', size: 3, state: 'uploaded' },
					{ name: 'b', size: 4, state: 'uploaded' },
				],
				[
					{ name: 'a', size: 3 },
					{ name: 'b', size: 4 },
				],
			),
			true,
		);
	});

	it('rejects a same-size asset whose upload is incomplete', () => {
		assert.equal(
			assetsAreComplete([{ name: 'a', size: 3, state: 'open' }], [{ name: 'a', size: 3 }]),
			false,
		);
	});
});
