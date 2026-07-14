import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateMcpToken } from './mcpToken.js';

describe('loadOrCreateMcpToken', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), 'otelux-mcp-token-'));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('generates and persists a token on first use', async () => {
		const file = join(dir, 'mcp-token');
		const token = await loadOrCreateMcpToken(file);
		expect(token.length).toBeGreaterThanOrEqual(32);
		const onDisk = (await fs.readFile(file, 'utf8')).trim();
		expect(onDisk).toBe(token);
	});

	it('returns the same token on subsequent calls', async () => {
		const file = join(dir, 'mcp-token');
		const first = await loadOrCreateMcpToken(file);
		const second = await loadOrCreateMcpToken(file);
		expect(second).toBe(first);
	});

	it('reads a pre-seeded token file', async () => {
		const file = join(dir, 'mcp-token');
		await fs.writeFile(file, 'preseeded-token\n', 'utf8');
		const token = await loadOrCreateMcpToken(file);
		expect(token).toBe('preseeded-token');
	});
});
