import { describe, expect, it } from 'vitest';
import { parseAgentInspection } from './validation.js';

const fixture = {
	agent: {
		id: 'claude-code',
		displayName: 'Claude Code',
		documentationUrl: 'https://docs.anthropic.com/en/docs/claude-code',
	},
	detected: true,
	installations: [{ executable: '/usr/bin/claude', version: '2.1.220', supported: true }],
	capabilities: [
		{
			id: 'mcp',
			support: 'supported',
			configuration: 'configured',
			verification: 'verified',
		},
	],
	paths: [
		{
			path: '/home/test/.claude.json',
			scope: 'user',
			kind: 'file',
			exists: true,
			secure: true,
			sha256: 'a'.repeat(64),
			issues: [],
		},
	],
	restartRequired: false,
	issues: [],
};

describe('parseAgentInspection', () => {
	it('accepts the bounded inspection contract', () => {
		expect(parseAgentInspection(fixture)).toEqual(fixture);
	});

	it('rejects unknown fields and invalid hashes with paths', () => {
		expect(() => parseAgentInspection({ ...fixture, token: 'secret' })).toThrow('$.token');
		expect(() =>
			parseAgentInspection({
				...fixture,
				paths: [{ ...fixture.paths[0], sha256: 'bad' }],
			}),
		).toThrow('$.paths[0].sha256');
	});

	it('rejects unbounded collections', () => {
		expect(() =>
			parseAgentInspection({ ...fixture, issues: Array.from({ length: 65 }, () => 'issue') }),
		).toThrow('$.issues');
	});
});
