import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export async function loadOrCreateMcpToken(file: string): Promise<string> {
	try {
		const existing = (await fs.readFile(file, 'utf8')).trim();
		if (existing.length > 0) {
			return existing;
		}
	} catch {
		// Missing or unreadable: generate a fresh owner-only token below.
	}

	const token = randomBytes(32).toString('base64url');
	await fs.mkdir(dirname(file), { recursive: true });
	await fs.writeFile(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
	return token;
}
