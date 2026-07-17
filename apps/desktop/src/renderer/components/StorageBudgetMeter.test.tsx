import type { StorageUsageInfo } from '@otelux/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StorageBudgetMeter, formatStorageBytes } from './StorageBudgetMeter.js';

const MIB = 1024 * 1024;

const usage: StorageUsageInfo = {
	activePath: '/tmp/otelux.db',
	retentionBytes: 256 * MIB,
	databaseFileBytes: 250 * MIB,
	walBytes: 7 * MIB,
	sharedMemoryBytes: 32 * 1024,
	totalBytes: 257 * MIB + 32 * 1024,
};

describe('StorageBudgetMeter', () => {
	it('renders a retention-aligned meter and physical file breakdown', () => {
		const html = renderToStaticMarkup(
			<StorageBudgetMeter usage={usage} maxSizeMb={512} maxAgeHours={72} />,
		);

		expect(html).toContain('role="meter"');
		expect(html).toContain(`aria-valuemax="${512 * MIB}"`);
		expect(html).toContain(`aria-valuenow="${256 * MIB}"`);
		expect(html).toContain('style="width:50%"');
		expect(html).toContain('256 MB');
		expect(html).toContain('/ 512 MB');
		expect(html).toContain('72h window');
		expect(html).toContain('WAL 7.00 MB');
		expect(html).toContain('SHM 32.0 KB');
	});

	it('renders an unlimited size budget without fake meter values', () => {
		const html = renderToStaticMarkup(
			<StorageBudgetMeter usage={usage} maxSizeMb={0} maxAgeHours={0} />,
		);

		expect(html).not.toContain('role="meter"');
		expect(html).not.toContain('aria-valuenow');
		expect(html).toContain('No size limit');
		expect(html).toContain('No age limit');
		expect(html).toContain('\u221e');
	});

	it('renders bounded loading separately from an unlimited budget', () => {
		const html = renderToStaticMarkup(<StorageBudgetMeter maxSizeMb={512} maxAgeHours={72} />);

		expect(html).toContain('storage-budget--loading');
		expect(html).toContain('Measuring...');
		expect(html).toContain('/ 512 MB');
		expect(html).toContain('Measuring SQLite retention budget');
		expect(html).not.toContain('No size limit');
		expect(html).not.toContain('\u221e');
	});

	it('describes actual over-limit pressure to assistive technology', () => {
		const overLimit = { ...usage, retentionBytes: 600 * MIB };
		const html = renderToStaticMarkup(
			<StorageBudgetMeter usage={overLimit} maxSizeMb={512} maxAgeHours={72} />,
		);

		expect(html).toContain('aria-valuenow="536870912"');
		expect(html).toContain('aria-valuetext="600 MB of 512 MB (117%)"');
		expect(html).toContain('>117%<');
		expect(html).toContain('style="width:100%"');
	});

	it('formats byte quantities for compact operational display', () => {
		expect(formatStorageBytes(0)).toBe('0 B');
		expect(formatStorageBytes(768 * 1024)).toBe('768 KB');
		expect(formatStorageBytes(2.5 * MIB)).toBe('2.50 MB');
		expect(formatStorageBytes(3 * 1024 * MIB)).toBe('3.00 GB');
	});
});
