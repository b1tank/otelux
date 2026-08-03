import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EndpointBar } from './EndpointBar.js';

describe('EndpointBar receiver pressure', () => {
	it('shows overloaded export counts by signal', () => {
		const html = renderToStaticMarkup(
			<EndpointBar
				status={{
					kind: 'running',
					host: '127.0.0.1',
					port: 4319,
					pressure: { overloadedTraces: 2, overloadedLogs: 3, overloadedMetrics: 1 },
				}}
				mcpStatus={{ kind: 'disabled' }}
			/>,
		);
		expect(html).toContain('Dropped 6');
		expect(html).toContain('2 traces, 3 logs, 1 metrics rejected');
	});

	it('hides pressure chrome when nothing was rejected', () => {
		const html = renderToStaticMarkup(
			<EndpointBar
				status={{ kind: 'running', host: '127.0.0.1', port: 4319 }}
				mcpStatus={{ kind: 'disabled' }}
			/>,
		);
		expect(html).not.toContain('Dropped');
	});
});
