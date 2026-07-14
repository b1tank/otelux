import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Load the per-install MCP bearer token, generating and persisting one on
 * first use.
 *
 * The token gates HTTP access to the local MCP tools: because the MCP
 * listener binds loopback and MCP clients are not browsers, the origin
 * policy cannot distinguish a legitimate client from another process on
 * the same host. A shared secret does. The token is stored as a single
 * line in `<userData>/mcp-token` with owner-only permissions and reused
 * across restarts so a configured client keeps working.
 */
export async function loadOrCreateMcpToken(file: string): Promise<string> {
	try {
		const existing = (await fs.readFile(file, 'utf8')).trim();
		if (existing.length > 0) {
			return existing;
		}
	} catch {
		// Missing or unreadable — fall through and mint a fresh token.
	}

	// 32 bytes of CSPRNG output, URL-safe so it drops cleanly into an MCP
	// client's Authorization header or config file.
	const token = randomBytes(32).toString('base64url');
	await fs.mkdir(dirname(file), { recursive: true });
	await fs.writeFile(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
	return token;
}
