#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const API_ROOT = 'https://api.github.com';

export async function publishGitHubRelease(options, fetchImpl = fetch) {
	const { repository, token, tag, target, title, notes, assetPaths } = options;
	const request = async (url, init = {}, allowedStatuses = []) => {
		const response = await fetchImpl(url, {
			...init,
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'User-Agent': 'otelux-release-publisher',
				'X-GitHub-Api-Version': '2022-11-28',
				...init.headers,
			},
		});
		if (!response.ok && !allowedStatuses.includes(response.status)) {
			const detail = await response.text();
			throw new Error(`GitHub API ${response.status} for ${url}: ${detail}`);
		}
		return response;
	};
	const api = (path) => `${API_ROOT}/repos/${repository}${path}`;

	let tagTarget = await readTagCommit(request, api, tag);
	if (!tagTarget) {
		await request(api('/git/refs'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: target }),
		});
		// GitHub's ref creation API can be briefly eventually consistent. Retry
		// the read so a successful create is not misreported as an undefined tag.
		for (let attempt = 0; attempt < 5 && !tagTarget; attempt++) {
			tagTarget = await readTagCommit(request, api, tag);
			if (!tagTarget && attempt < 4) {
				await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
			}
		}
	}
	if (tagTarget !== target) {
		throw new Error(`Tag ${tag} points at ${tagTarget}, expected ${target}.`);
	}

	const assets = assetPaths.map((path) => ({
		name: basename(path),
		path,
		size: statSync(path).size,
	}));
	let release = await findRelease(request, api, tag);
	if (release && !release.draft && assetsAreComplete(release.assets, assets)) {
		return { status: 'already-published', releaseId: release.id, tag };
	}

	if (!release) {
		release = await json(
			await request(api('/releases'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tag_name: tag,
					target_commitish: target,
					name: title,
					body: notes,
					draft: true,
					prerelease: true,
				}),
			}),
		);
	} else {
		release = await json(
			await request(api(`/releases/${release.id}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: title, body: notes, prerelease: true }),
			}),
		);
	}

	if (!assetsAreComplete(release.assets, assets)) {
		const expectedNames = new Set(assets.map((asset) => asset.name));
		for (const existing of release.assets ?? []) {
			if (expectedNames.has(existing.name)) {
				await request(api(`/releases/assets/${existing.id}`), { method: 'DELETE' });
			}
		}
		for (const asset of assets) {
			const uploadUrl = release.upload_url.replace(
				'{?name,label}',
				`?name=${encodeURIComponent(asset.name)}`,
			);
			await request(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': contentType(asset.name) },
				body: readFileSync(asset.path),
			});
		}
	}

	await request(api(`/releases/${release.id}`), {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: title, body: notes, draft: false, prerelease: true }),
	});
	return { status: 'published', releaseId: release.id, tag };
}

async function readTagCommit(request, api, tag) {
	const response = await request(api(`/git/ref/tags/${encodeURIComponent(tag)}`), {}, [404]);
	if (response.status === 404) {
		return undefined;
	}
	let object = (await json(response)).object;
	while (object.type === 'tag') {
		object = (await json(await request(api(`/git/tags/${object.sha}`)))).object;
	}
	if (object.type !== 'commit') {
		throw new Error(`Tag ${tag} resolves to unsupported Git object type ${object.type}.`);
	}
	return object.sha;
}

async function findRelease(request, api, tag) {
	for (let page = 1; ; page++) {
		const releases = await json(await request(api(`/releases?per_page=100&page=${page}`)));
		const match = releases.find((release) => release.tag_name === tag);
		if (match || releases.length < 100) {
			return match;
		}
	}
}

export function assetsAreComplete(existingAssets, expectedAssets) {
	return expectedAssets.every((expected) =>
		(existingAssets ?? []).some(
			(existing) =>
				existing.name === expected.name &&
				existing.size === expected.size &&
				existing.state === 'uploaded',
		),
	);
}

function contentType(name) {
	if (name.endsWith('.json')) {
		return 'application/json';
	}
	if (name.endsWith('.deb')) {
		return 'application/vnd.debian.binary-package';
	}
	return 'text/plain';
}

async function json(response) {
	return await response.json();
}

function parseArguments(args) {
	const values = {};
	const assetPaths = [];
	for (let index = 0; index < args.length; index++) {
		const value = args[index];
		if (value === '--asset') {
			assetPaths.push(args[++index]);
		} else if (value?.startsWith('--')) {
			values[value.slice(2)] = args[++index];
		} else {
			throw new Error(`Unexpected argument: ${value}`);
		}
	}
	for (const required of ['repository', 'tag', 'target', 'title', 'notes-file']) {
		if (!values[required]) {
			throw new Error(`Missing --${required}`);
		}
	}
	if (assetPaths.length === 0) {
		throw new Error('At least one --asset is required.');
	}
	if (!process.env.GH_TOKEN) {
		throw new Error('GH_TOKEN is required.');
	}
	return {
		repository: values.repository,
		token: process.env.GH_TOKEN,
		tag: values.tag,
		target: values.target,
		title: values.title,
		notes: readFileSync(values['notes-file'], 'utf8'),
		assetPaths,
	};
}

if (process.argv[1]?.endsWith('publish-github-release.mjs')) {
	const result = await publishGitHubRelease(parseArguments(process.argv.slice(2)));
	console.log(`${result.status}: ${result.tag} (release ${result.releaseId})`);
}
