import { DEFAULT_SETTINGS } from '@otelux/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsModal, parseRetentionLimit, validateSettingsInput } from './SettingsModal.js';

const validInput = {
	otlpPort: '4319',
	mcpEnabled: true,
	mcpPort: '4320',
	retentionAge: '72',
	retentionSize: '512',
	databasePath: '',
} as const;

describe('parseRetentionLimit', () => {
	it('accepts only complete non-negative integer strings', () => {
		expect(parseRetentionLimit('0')).toBe(0);
		expect(parseRetentionLimit('512')).toBe(512);
		expect(parseRetentionLimit('1.5')).toBeUndefined();
		expect(parseRetentionLimit('-1')).toBeUndefined();
		expect(parseRetentionLimit('12hours')).toBeUndefined();
		expect(parseRetentionLimit('')).toBeUndefined();
	});
});

describe('validateSettingsInput', () => {
	it('routes endpoint validation errors to Connections', () => {
		expect(validateSettingsInput({ ...validInput, mcpPort: '4319' })).toEqual({
			ok: false,
			category: 'connections',
			field: 'mcpPort',
			error: 'MCP port must differ from OTLP port.',
		});
	});

	it('routes retention and database validation errors to Storage', () => {
		expect(validateSettingsInput({ ...validInput, retentionSize: '1.5' })).toEqual({
			ok: false,
			category: 'storage',
			field: 'retentionSize',
			error: 'Retention size must be between 0 and 1048576 MB (0 = unlimited).',
		});
		expect(validateSettingsInput({ ...validInput, databasePath: 'relative/otelux.db' })).toEqual({
			ok: false,
			category: 'storage',
			field: 'databasePath',
			error: 'Database path must be an absolute path, or blank for the default location.',
		});
	});

	it('builds one complete settings patch from valid input', () => {
		expect(validateSettingsInput({ ...validInput, databasePath: '  /tmp/otelux.db  ' })).toEqual({
			ok: true,
			patch: {
				otlp: { port: 4319 },
				mcp: { enabled: true, port: 4320 },
				retention: { maxAgeHours: 72, maxSizeMb: 512 },
				storage: { dbPath: '/tmp/otelux.db' },
			},
		});
	});
});

describe('SettingsModal', () => {
	it('renders one selected category and one visible panel by default', () => {
		const html = renderToStaticMarkup(
			createElement(SettingsModal, {
				settings: DEFAULT_SETTINGS,
				onSave: () => Promise.resolve({ ok: false as const, error: 'unused' }),
				onClose: () => undefined,
			}),
		);

		expect(html).toContain('role="tablist"');
		expect(html).toContain('aria-orientation="vertical"');
		expect(html).toContain('novalidate=""');
		expect(html).toContain('id="settings-tab-connections"');
		expect(html).toContain('aria-selected="true" tabindex="0"');
		expect(html).toContain('id="settings-tab-storage"');
		expect(html).toContain('aria-selected="false" tabindex="-1"');
		expect(html).toContain('aria-label="OTLP receiver port"');
		expect(html).toContain('aria-describedby="settings-otlp-port-hint"');
		expect(html).toContain('aria-label="MCP server port"');
		expect(html).toContain('aria-describedby="settings-mcp-port-hint"');
		expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
		expect(html.match(/ hidden=""/g)).toHaveLength(1);
	});
});
