import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeCommandRunner, inspectAgentPath } from './node.js';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporary(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'otelux-agent-inspection-'));
	directories.push(path);
	return path;
}

describe('inspectAgentPath', () => {
	it('hashes one owner-controlled regular file without returning its contents', async () => {
		const root = await temporary();
		const path = join(root, 'settings.json');
		await writeFile(path, 'private-value', { mode: 0o600 });
		const result = await inspectAgentPath({
			path,
			allowedRoot: root,
			scope: 'user',
			kind: 'file',
			hashContents: true,
		});
		expect(result).toMatchObject({ exists: true, secure: true, issues: [] });
		expect(result.sha256).toBe(createHash('sha256').update('private-value').digest('hex'));
		expect(JSON.stringify(result)).not.toContain('private-value');
	});

	it('rejects paths outside scope and symbolic links', async () => {
		const root = await temporary();
		const outside = await temporary();
		const target = join(outside, 'target');
		await writeFile(target, 'value');
		expect(
			await inspectAgentPath({
				path: target,
				allowedRoot: root,
				scope: 'project',
				kind: 'file',
			}),
		).toMatchObject({ secure: false, issues: ['path is outside the selected scope'] });
		const link = join(root, 'link');
		await symlink(target, link);
		expect(
			await inspectAgentPath({
				path: link,
				allowedRoot: root,
				scope: 'project',
				kind: 'file',
			}),
		).toMatchObject({ secure: false, issues: ['path is a symbolic link'] });
	});

	it('reports a world-writable parent', async () => {
		if (process.platform === 'win32') return;
		const root = await temporary();
		const parent = join(root, 'unsafe');
		await mkdir(parent, { mode: 0o777 });
		await chmod(parent, 0o777);
		const result = await inspectAgentPath({
			path: join(parent, 'missing.json'),
			allowedRoot: root,
			scope: 'project',
			kind: 'file',
		});
		expect(result.secure).toBe(false);
		expect(result.issues).toContain('scope parent is world-writable');
	});
});

describe('createNodeCommandRunner', () => {
	it('uses an argument array without shell interpolation', async () => {
		const runner = createNodeCommandRunner();
		const result = await runner.run(process.execPath, [
			'-e',
			'process.stdout.write(process.argv[1])',
			'; echo unsafe',
		]);
		expect(result).toEqual({ exitCode: 0, stdout: '; echo unsafe', stderr: '' });
	});

	it('returns bounded failures instead of throwing process errors', async () => {
		const runner = createNodeCommandRunner({ maxOutputBytes: 8 });
		const result = await runner.run(process.execPath, [
			'-e',
			'process.stderr.write("long-error"); process.exit(7)',
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe('long-err');
	});
});
