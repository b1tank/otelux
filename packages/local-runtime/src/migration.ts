import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
	access,
	chmod,
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const MIGRATION_MARKER = '.legacy-migration.json';
const DATABASE_FILE = 'otelux.db';
const DATABASE_SIDECARS = ['otelux.db-wal', 'otelux.db-shm'] as const;
const AUXILIARY_FILES = ['settings.json', 'mcp-token'] as const;
const ALLOWED_FILES = new Set<string>([DATABASE_FILE, ...DATABASE_SIDECARS, ...AUXILIARY_FILES]);

interface MigrationMarker {
	readonly version: 1;
	readonly sourceDirectory: string;
	readonly files: readonly string[];
	readonly createdAt: string;
}

export interface LegacyMigrationLogger {
	info(message: string): void;
	error(message: string): void;
}

export interface PrepareDataDirectoryOptions {
	readonly dataDirectory: string;
	readonly legacyDataDirectories?: readonly string[];
	readonly logger?: LegacyMigrationLogger;
}

export type LegacyMigrationResult =
	| { readonly kind: 'none' }
	| {
			readonly kind: 'migrated';
			readonly sourceDirectory: string;
			readonly files: readonly string[];
	  }
	| {
			readonly kind: 'conflict';
			readonly sourceDirectory: string;
			readonly canonicalDatabase: string;
			readonly legacyDatabase: string;
	  };

/**
 * Prepare the canonical data directory and copy legacy Desktop state into it.
 *
 * Copies are atomic at the destination and the legacy files are intentionally
 * retained. A marker makes an interrupted migration resumable before SQLite is
 * opened. Existing canonical files always win; two populated default databases
 * are reported as a conflict and never merged or overwritten.
 */
export async function prepareDataDirectory(
	options: PrepareDataDirectoryOptions,
): Promise<LegacyMigrationResult> {
	const dataDirectory = resolve(options.dataDirectory);
	const logger = options.logger ?? console;
	await ensurePrivateDirectory(dataDirectory);

	const resumed = await readMarker(dataDirectory);
	if (resumed) {
		await copyMarkedFiles(dataDirectory, resumed);
		logger.info(
			`[otelux] resumed legacy data migration from ${resumed.sourceDirectory} to ${dataDirectory}`,
		);
		return {
			kind: 'migrated',
			sourceDirectory: resumed.sourceDirectory,
			files: resumed.files,
		};
	}

	const candidates = [...new Set(options.legacyDataDirectories ?? [])]
		.filter((candidate) => isAbsolute(candidate))
		.map((candidate) => resolve(candidate))
		.filter((candidate) => candidate !== dataDirectory);

	for (const sourceDirectory of candidates) {
		const sourceSettings = join(sourceDirectory, 'settings.json');
		const canonicalSettings = join(dataDirectory, 'settings.json');
		const settingsPath = (await exists(canonicalSettings)) ? canonicalSettings : sourceSettings;
		const customDatabasePath = await readConfiguredDatabasePath(settingsPath);
		const legacyDatabase = join(sourceDirectory, DATABASE_FILE);
		const canonicalDatabase = join(dataDirectory, DATABASE_FILE);

		const legacyDatabasePopulated = await isPopulatedFile(legacyDatabase);
		const canonicalDatabasePopulated = await isPopulatedFile(canonicalDatabase);
		if (customDatabasePath === '' && legacyDatabasePopulated && canonicalDatabasePopulated) {
			logger.error(
				`[otelux] both canonical and legacy databases contain data; preserving both (${canonicalDatabase}, ${legacyDatabase})`,
			);
			return { kind: 'conflict', sourceDirectory, canonicalDatabase, legacyDatabase };
		}
		if (
			customDatabasePath === '' &&
			legacyDatabasePopulated &&
			(await exists(canonicalDatabase)) &&
			!canonicalDatabasePopulated
		) {
			await rm(canonicalDatabase, { force: true });
		}

		const databaseFiles = customDatabasePath === '' ? [...DATABASE_SIDECARS, DATABASE_FILE] : [];
		const files = [];
		for (const file of [...databaseFiles, ...AUXILIARY_FILES]) {
			if ((await exists(join(sourceDirectory, file))) && !(await exists(join(dataDirectory, file)))) {
				files.push(file);
			}
		}
		if (files.length === 0) {
			continue;
		}

		const marker: MigrationMarker = {
			version: 1,
			sourceDirectory,
			files,
			createdAt: new Date().toISOString(),
		};
		await writeJsonAtomic(join(dataDirectory, MIGRATION_MARKER), marker);
		await copyMarkedFiles(dataDirectory, marker);
		logger.info(
			`[otelux] copied legacy data from ${sourceDirectory} to ${dataDirectory}; source files were preserved`,
		);
		return { kind: 'migrated', sourceDirectory, files };
	}

	return { kind: 'none' };
}

async function copyMarkedFiles(dataDirectory: string, marker: MigrationMarker): Promise<void> {
	for (const file of marker.files) {
		if (!ALLOWED_FILES.has(file)) {
			throw new Error(`Invalid legacy migration file: ${file}`);
		}
		const source = join(marker.sourceDirectory, file);
		const destination = join(dataDirectory, file);
		if (await exists(destination)) {
			continue;
		}
		if (!(await exists(source))) {
			throw new Error(`Legacy migration source disappeared: ${source}`);
		}
		await copyAtomic(source, destination);
		if (file === 'mcp-token' || file === 'settings.json') {
			await chmod(destination, 0o600);
		}
	}
	await rm(join(dataDirectory, MIGRATION_MARKER), { force: true });
}

async function readMarker(dataDirectory: string): Promise<MigrationMarker | undefined> {
	const path = join(dataDirectory, MIGRATION_MARKER);
	if (!(await exists(path))) {
		return undefined;
	}
	try {
		const value = JSON.parse(await readFile(path, 'utf8')) as Partial<MigrationMarker>;
		if (
			value.version === 1 &&
			typeof value.sourceDirectory === 'string' &&
			isAbsolute(value.sourceDirectory) &&
			Array.isArray(value.files) &&
			value.files.every((file) => typeof file === 'string' && ALLOWED_FILES.has(file)) &&
			typeof value.createdAt === 'string'
		) {
			return value as MigrationMarker;
		}
	} catch {
		// Invalid markers are rejected below rather than silently discarded.
	}
	throw new Error(`Invalid legacy migration marker: ${path}`);
}

async function readConfiguredDatabasePath(path: string): Promise<string> {
	try {
		const settings = JSON.parse(await readFile(path, 'utf8')) as {
			storage?: { dbPath?: unknown };
		};
		return typeof settings.storage?.dbPath === 'string' ? settings.storage.dbPath : '';
	} catch {
		return '';
	}
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') {
		await chmod(path, 0o700);
	}
}

async function copyAtomic(source: string, destination: string): Promise<void> {
	const temporary = `${destination}.migrating-${randomUUID()}`;
	try {
		await copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.tmp-${randomUUID()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function isPopulatedFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).size > 0;
	} catch {
		return false;
	}
}
