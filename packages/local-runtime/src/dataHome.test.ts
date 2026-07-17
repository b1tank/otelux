import { describe, expect, it } from 'vitest';
import { resolveOteluxDataDirectory } from './dataHome.js';

describe('resolveOteluxDataDirectory', () => {
	it('uses XDG_DATA_HOME on Linux', () => {
		expect(
			resolveOteluxDataDirectory({
				platform: 'linux',
				environment: { XDG_DATA_HOME: '/data' },
				homeDirectory: '/home/user',
			}),
		).toBe('/data/otelux');
	});

	it('falls back to the Linux user data directory when XDG_DATA_HOME is relative', () => {
		expect(
			resolveOteluxDataDirectory({
				platform: 'linux',
				environment: { XDG_DATA_HOME: 'relative' },
				homeDirectory: '/home/user',
			}),
		).toBe('/home/user/.local/share/otelux');
	});

	it('uses the platform application data directories on macOS and Windows', () => {
		expect(
			resolveOteluxDataDirectory({
				platform: 'darwin',
				environment: {},
				homeDirectory: '/Users/person',
			}),
		).toBe('/Users/person/Library/Application Support/OTelux');
		expect(
			resolveOteluxDataDirectory({
				platform: 'win32',
				environment: { LOCALAPPDATA: 'C:\\Users\\person\\AppData\\Local' },
				homeDirectory: 'C:\\Users\\person',
			}),
		).toBe('C:\\Users\\person\\AppData\\Local\\OTelux');
	});

	it('honors an absolute OTELUX_DATA_DIR override', () => {
		expect(
			resolveOteluxDataDirectory({
				platform: 'linux',
				environment: { OTELUX_DATA_DIR: '/tmp/otelux-data' },
				homeDirectory: '/home/user',
			}),
		).toBe('/tmp/otelux-data');
	});

	it('rejects a relative OTELUX_DATA_DIR override', () => {
		expect(() =>
			resolveOteluxDataDirectory({
				platform: 'linux',
				environment: { OTELUX_DATA_DIR: 'relative' },
				homeDirectory: '/home/user',
			}),
		).toThrow('OTELUX_DATA_DIR must be an absolute path');
	});
});
