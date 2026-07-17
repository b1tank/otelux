import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareDataDirectory } from './migration.js';

const silentLogger = {
	info: (): void => {},
	error: (): void => {},
};

describe('prepareDataDirectory', () => {
	let root: string;
	let canonical: string;
	let legacy: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(join(tmpdir(), 'otelux-migration-'));
		canonical = join(root, 'canonical');
		legacy = join(root, 'legacy');
		await fs.mkdir(legacy);
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it('copies legacy database state into an empty canonical directory and preserves source files', async () => {
		await fs.writeFile(join(legacy, 'otelux.db'), 'database');
		await fs.writeFile(join(legacy, 'otelux.db-wal'), 'wal');
		await fs.writeFile(join(legacy, 'settings.json'), '{"version":1,"storage":{"dbPath":""}}');
		await fs.writeFile(join(legacy, 'mcp-token'), 'token');

		const result = await prepareDataDirectory({
			dataDirectory: canonical,
			legacyDataDirectories: [legacy],
			logger: silentLogger,
		});

		expect(result).toEqual({
			kind: 'migrated',
			sourceDirectory: legacy,
			files: ['otelux.db-wal', 'otelux.db', 'settings.json', 'mcp-token'],
		});
		expect(await fs.readFile(join(canonical, 'otelux.db'), 'utf8')).toBe('database');
		expect(await fs.readFile(join(canonical, 'mcp-token'), 'utf8')).toBe('token');
		expect(await fs.readFile(join(legacy, 'otelux.db'), 'utf8')).toBe('database');
		await expect(fs.access(join(canonical, '.legacy-migration.json'))).rejects.toThrow();
	});

	it('preserves a configured custom database instead of copying the legacy default database', async () => {
		await fs.writeFile(join(legacy, 'otelux.db'), 'legacy-default');
		await fs.writeFile(
			join(legacy, 'settings.json'),
			JSON.stringify({ version: 1, storage: { dbPath: '/custom/otelux.db' } }),
		);

		const result = await prepareDataDirectory({
			dataDirectory: canonical,
			legacyDataDirectories: [legacy],
			logger: silentLogger,
		});

		expect(result).toEqual({
			kind: 'migrated',
			sourceDirectory: legacy,
			files: ['settings.json'],
		});
		await expect(fs.access(join(canonical, 'otelux.db'))).rejects.toThrow();
	});

	it('reports two default databases as a conflict without overwriting either one', async () => {
		await fs.mkdir(canonical);
		await fs.writeFile(join(canonical, 'otelux.db'), 'canonical');
		await fs.writeFile(join(legacy, 'otelux.db'), 'legacy');

		const result = await prepareDataDirectory({
			dataDirectory: canonical,
			legacyDataDirectories: [legacy],
			logger: silentLogger,
		});

		expect(result).toEqual({
			kind: 'conflict',
			sourceDirectory: legacy,
			canonicalDatabase: join(canonical, 'otelux.db'),
			legacyDatabase: join(legacy, 'otelux.db'),
		});
		expect(await fs.readFile(join(canonical, 'otelux.db'), 'utf8')).toBe('canonical');
		expect(await fs.readFile(join(legacy, 'otelux.db'), 'utf8')).toBe('legacy');
	});

	it('replaces an empty canonical database with a populated legacy database', async () => {
		await fs.mkdir(canonical);
		await fs.writeFile(join(canonical, 'otelux.db'), '');
		await fs.writeFile(join(legacy, 'otelux.db'), 'legacy');

		const result = await prepareDataDirectory({
			dataDirectory: canonical,
			legacyDataDirectories: [legacy],
			logger: silentLogger,
		});

		expect(result.kind).toBe('migrated');
		expect(await fs.readFile(join(canonical, 'otelux.db'), 'utf8')).toBe('legacy');
	});

	it('resumes an interrupted migration before returning', async () => {
		await fs.mkdir(canonical);
		await fs.writeFile(join(legacy, 'otelux.db'), 'database');
		await fs.writeFile(join(legacy, 'settings.json'), '{"version":1}');
		await fs.writeFile(join(canonical, 'otelux.db'), 'database');
		await fs.writeFile(
			join(canonical, '.legacy-migration.json'),
			JSON.stringify({
				version: 1,
				sourceDirectory: legacy,
				files: ['otelux.db', 'settings.json'],
				createdAt: '2026-07-16T00:00:00.000Z',
			}),
		);

		const result = await prepareDataDirectory({
			dataDirectory: canonical,
			logger: silentLogger,
		});

		expect(result.kind).toBe('migrated');
		expect(await fs.readFile(join(canonical, 'settings.json'), 'utf8')).toBe('{"version":1}');
		await expect(fs.access(join(canonical, '.legacy-migration.json'))).rejects.toThrow();
	});
});
