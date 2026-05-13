import type { DataSource } from '@otelux/protocol';
import { render } from '@testing-library/react';
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { OTELUX_UI_VERSION, OTeluxWorkbench } from './index.js';

const mockDataSource: DataSource = {
	kind: 'otelux/datasource',
	listTraces: async () => ({ rows: [], totalCount: 0 }),
	getTrace: async () => ({
		traceId: '',
		spans: [],
		startTimeUnixNano: 0n,
		endTimeUnixNano: 0n,
		durationNanos: 0n,
		services: [],
		spanCount: 0,
		errorCount: 0,
	}),
	getSpanDetails: async () => {
		throw new Error('not found');
	},
	subscribe: () => ({ dispose: () => {} }),
};

describe('@otelux/ui', () => {
	it('renders the workbench placeholder', () => {
		const { container } = render(<OTeluxWorkbench dataSource={mockDataSource} />);
		expect(container.querySelector('.otelux-workbench')).not.toBeNull();
	});

	it('applies the requested theme attribute', () => {
		const { container } = render(<OTeluxWorkbench dataSource={mockDataSource} theme="dark" />);
		const root = container.querySelector('.otelux-workbench');
		expect(root?.getAttribute('data-theme')).toBe('dark');
	});

	it('exports a version constant', () => {
		expect(OTELUX_UI_VERSION).toBe('0.0.0');
	});
});
