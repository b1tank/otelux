import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateMcpToken } from './mcpToken.js';

describe('loadOrCreateMcpToken', () => {
	let directory: string;

	beforeEach(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'otelux-mcp-token-'));
	});

	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	it('generates and persists a token on first use', async () => {
		const file = join(directory, 'mcp-token');
		const token = await loadOrCreateMcpToken(file);
		expect(token.length).toBeGreaterThanOrEqual(32);
		expect((await fs.readFile(file, 'utf8')).trim()).toBe(token);
	});

	it('returns the same token on subsequent calls', async () => {
		const file = join(directory, 'mcp-token');
		const first = await loadOrCreateMcpToken(file);
		expect(await loadOrCreateMcpToken(file)).toBe(first);
	});

	it('reads a pre-seeded token file', async () => {
		const file = join(directory, 'mcp-token');
		await fs.writeFile(file, 'preseeded-token\n', 'utf8');
		expect(await loadOrCreateMcpToken(file)).toBe('preseeded-token');
	});
});
