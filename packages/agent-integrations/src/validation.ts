import type {
	AgentCapabilityId,
	AgentCapabilityState,
	AgentDescriptor,
	AgentId,
	AgentInspection,
	AgentScope,
	DetectedInstallation,
	InspectedPath,
} from './contracts.js';

const AGENTS = new Set<AgentId>(['claude-code', 'codex', 'pi']);
const SCOPES = new Set<AgentScope>(['local', 'project', 'user']);
const CAPABILITIES = new Set<AgentCapabilityId>([
	'mcp',
	'skills',
	'plugin',
	'telemetry',
	'sensitive-content',
]);

export function parseAgentInspection(value: unknown): AgentInspection {
	const input = record(value, '$');
	exactKeys(
		input,
		['agent', 'detected', 'installations', 'capabilities', 'paths', 'restartRequired', 'issues'],
		'$',
	);
	return {
		agent: parseDescriptor(input.agent, '$.agent'),
		detected: boolean(input.detected, '$.detected'),
		installations: array(input.installations, '$.installations').map((entry, index) =>
			parseInstallation(entry, `$.installations[${index}]`),
		),
		capabilities: array(input.capabilities, '$.capabilities').map((entry, index) =>
			parseCapability(entry, `$.capabilities[${index}]`),
		),
		paths: array(input.paths, '$.paths').map((entry, index) => parsePath(entry, `$.paths[${index}]`)),
		restartRequired: boolean(input.restartRequired, '$.restartRequired'),
		issues: strings(input.issues, '$.issues'),
	};
}

function parseDescriptor(value: unknown, path: string): AgentDescriptor {
	const input = record(value, path);
	exactKeys(input, ['id', 'displayName', 'documentationUrl'], path);
	const id = string(input.id, `${path}.id`, 64);
	if (!AGENTS.has(id as AgentId)) fail(`${path}.id`, 'known agent ID');
	const documentationUrl = string(input.documentationUrl, `${path}.documentationUrl`, 512);
	try {
		const url = new URL(documentationUrl);
		if (url.protocol !== 'https:') fail(`${path}.documentationUrl`, 'HTTPS URL');
	} catch {
		fail(`${path}.documentationUrl`, 'HTTPS URL');
	}
	return {
		id: id as AgentId,
		displayName: string(input.displayName, `${path}.displayName`, 128),
		documentationUrl,
	};
}

function parseInstallation(value: unknown, path: string): DetectedInstallation {
	const input = record(value, path);
	exactKeys(input, ['executable', 'version', 'supported', 'reason'], path);
	return {
		executable: string(input.executable, `${path}.executable`, 4096),
		version: string(input.version, `${path}.version`, 128),
		supported: boolean(input.supported, `${path}.supported`),
		...(input.reason !== undefined ? { reason: string(input.reason, `${path}.reason`, 512) } : {}),
	};
}

function parseCapability(value: unknown, path: string): AgentCapabilityState {
	const input = record(value, path);
	exactKeys(input, ['id', 'support', 'configuration', 'verification', 'sensitive', 'reason'], path);
	const id = string(input.id, `${path}.id`, 64);
	if (!CAPABILITIES.has(id as AgentCapabilityId)) fail(`${path}.id`, 'known capability ID');
	return {
		id: id as AgentCapabilityId,
		support: enumeration(input.support, `${path}.support`, [
			'supported',
			'unsupported',
			'unknown-version',
		]),
		configuration: enumeration(input.configuration, `${path}.configuration`, [
			'configured',
			'not-configured',
			'unknown',
		]),
		verification: enumeration(input.verification, `${path}.verification`, [
			'verified',
			'not-verified',
			'failed',
			'not-applicable',
		]),
		...(input.sensitive !== undefined
			? { sensitive: boolean(input.sensitive, `${path}.sensitive`) }
			: {}),
		...(input.reason !== undefined ? { reason: string(input.reason, `${path}.reason`, 512) } : {}),
	};
}

function parsePath(value: unknown, path: string): InspectedPath {
	const input = record(value, path);
	exactKeys(input, ['path', 'scope', 'kind', 'exists', 'secure', 'sha256', 'issues'], path);
	const scope = string(input.scope, `${path}.scope`, 32);
	if (!SCOPES.has(scope as AgentScope)) fail(`${path}.scope`, 'known scope');
	const sha256 = input.sha256 === undefined ? undefined : string(input.sha256, `${path}.sha256`, 64);
	if (sha256 !== undefined && !/^[a-f0-9]{64}$/.test(sha256)) fail(`${path}.sha256`, 'SHA-256 hex');
	return {
		path: string(input.path, `${path}.path`, 4096),
		scope: scope as AgentScope,
		kind: enumeration(input.kind, `${path}.kind`, ['file', 'directory']),
		exists: boolean(input.exists, `${path}.exists`),
		secure: boolean(input.secure, `${path}.secure`),
		...(sha256 !== undefined ? { sha256 } : {}),
		issues: strings(input.issues, `${path}.issues`),
	};
}

function strings(value: unknown, path: string): string[] {
	return array(value, path).map((entry, index) => string(entry, `${path}[${index}]`, 512));
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value) || value.length > 64) fail(path, 'array with at most 64 entries');
	return value;
}

function string(value: unknown, path: string, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
		fail(path, `non-empty string up to ${maximum} characters`);
	return value;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') fail(path, 'boolean');
	return value;
}

function enumeration<const T extends string>(
	value: unknown,
	path: string,
	allowed: readonly T[],
): T {
	if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, allowed.join(' | '));
	return value as T;
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[], path: string): void {
	const allowed = new Set(keys);
	for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`${path}.${key}`, 'known field');
}

function fail(path: string, expected: string): never {
	throw new Error(`${path}: expected ${expected}`);
}
