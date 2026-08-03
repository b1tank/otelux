#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createNodeSqliteStorage } from '../../../packages/engine-node/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = process.env.OTELUX_SMOKE_DESKTOP_DIR ?? join(here, '..');
const binary = join(desktopDir, 'release', 'linux-unpacked', 'otelux');
const root = mkdtempSync(join(tmpdir(), 'otelux-perf-'));
const dataDir = join(root, 'data');
const userDataDir = join(root, 'electron');
const dbPath = join(dataDir, 'otelux.db');
mkdirSync(dataDir, { recursive: true });

const freePort = () =>
	new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') return reject(new Error('no port'));
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
const [otlpPort, mcpPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()]);

function span(traceIndex, spanIndex, parentSpanId, name, start, service = 'perf-api') {
	const traceId = traceIndex.toString(16).padStart(32, '0');
	const spanId = (traceIndex * 100_000 + spanIndex + 1).toString(16).padStart(16, '0');
	return {
		traceId,
		spanId,
		...(parentSpanId ? { parentSpanId } : {}),
		name,
		kind: 1,
		startTimeUnixNano: start,
		endTimeUnixNano: start + 500_000n,
		status: { code: 1 },
		attributes: { 'perf.index': BigInt(spanIndex), payload: 'x'.repeat(96) },
		resource: { attributes: { 'service.namespace': 'perf-audit', 'service.name': service } },
		scope: { name: 'otelux-perf' },
	};
}

console.log('Preparing 10,000 traces / 200,000 spans plus deep/wide adversarial traces…');
const storage = createNodeSqliteStorage({ path: dbPath, pruneIntervalMs: 0 });
const ingestStart = performance.now();
const batch = [];
const flush = () => {
	if (batch.length) storage.writeSpans(batch.splice(0));
};
const base = 1_780_000_000_000_000_000n;
for (let traceIndex = 1; traceIndex <= 10_000; traceIndex++) {
	let parent;
	for (let spanIndex = 0; spanIndex < 20; spanIndex++) {
		const item = span(
			traceIndex,
			spanIndex,
			parent,
			spanIndex === 0 ? `request-${traceIndex}` : `operation-${spanIndex}`,
			base + BigInt(traceIndex) * 1_000_000n + BigInt(spanIndex),
		);
		parent = item.spanId;
		batch.push(item);
	}
	if (batch.length >= 2_000) flush();
}
// Newest traces remain in the first 200-row list page.
let parent;
for (let index = 0; index < 5_000; index++) {
	const item = span(
		20_001,
		index,
		parent,
		index === 0 ? 'perf-deep-root' : `perf-deep-${index}`,
		base + 20_001_000_000n + BigInt(index),
		'perf-deep',
	);
	parent = item.spanId;
	batch.push(item);
	if (batch.length >= 2_000) flush();
}
for (let index = 0; index < 10_000; index++) {
	batch.push(
		span(
			20_002,
			index,
			undefined,
			index === 0 ? 'perf-wide-root' : `perf-wide-${index}`,
			base + 20_002_000_000n + BigInt(index),
			'perf-wide',
		),
	);
	if (batch.length >= 2_000) flush();
}
flush();
storage.close();
console.log(`Fixture ready in ${Math.round(performance.now() - ingestStart)} ms`);

writeFileSync(
	join(dataDir, 'settings.json'),
	JSON.stringify({
		version: 1,
		otlp: { port: otlpPort },
		mcp: { enabled: true, port: mcpPort },
		retention: { maxAgeHours: 0, maxSizeMb: 0 },
		storage: { dbPath: '' },
	}),
);

const child = spawn(
	binary,
	['--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`],
	{
		env: { ...process.env, OTELUX_DATA_DIR: dataDir },
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	},
);
let logs = '';
child.stdout.on('data', (chunk) => {
	logs += chunk;
});
child.stderr.on('data', (chunk) => {
	logs += chunk;
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const value = await fn();
			if (value) return value;
		} catch {}
		await sleep(100);
	}
	throw new Error(`timeout\n${logs.slice(-4000)}`);
}

function cdp(webSocketDebuggerUrl) {
	const socket = new WebSocket(webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		message.error
			? request.reject(new Error(JSON.stringify(message.error)))
			: request.resolve(message.result);
	};
	const ready = new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	return {
		async send(method, params = {}) {
			await ready;
			const requestId = ++id;
			return new Promise((resolve, reject) => {
				pending.set(requestId, { resolve, reject });
				socket.send(JSON.stringify({ id: requestId, method, params }));
			});
		},
		close() {
			socket.close();
		},
	};
}

let client;
try {
	await waitFor(async () => (await fetch(`http://127.0.0.1:${otlpPort}/healthz`)).ok);
	const target = await waitFor(async () => {
		const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
		return targets.find((item) => item.type === 'page');
	});
	client = cdp(target.webSocketDebuggerUrl);
	await client.send('Runtime.enable');
	const evaluate = async (expression, awaitPromise = true) => {
		const result = await client.send('Runtime.evaluate', {
			expression,
			awaitPromise,
			returnByValue: true,
		});
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
		return result.result.value;
	};
	await waitFor(async () => evaluate(`document.querySelectorAll('.otelux-trace-row').length > 0`));

	const structural = await evaluate(`(() => ({
    traceRows: document.querySelectorAll('.otelux-trace-row').length,
    totalDom: document.querySelectorAll('*').length,
    listText: document.querySelector('.otelux-trace-list__count')?.textContent
  }))()`);
	if (structural.traceRows >= 50)
		throw new Error(`trace row budget exceeded: ${JSON.stringify(structural)}`);

	const continuousIngest = Promise.all(
		Array.from({ length: 40 }, (_, index) =>
			fetch(`http://127.0.0.1:${otlpPort}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					resourceSpans: [
						{
							resource: { attributes: [{ key: 'service.name', value: { stringValue: 'perf-live' } }] },
							scopeSpans: [
								{
									spans: [
										{
											traceId: (30_000 + index).toString(16).padStart(32, '0'),
											spanId: (30_000 + index).toString(16).padStart(16, '0'),
											name: `live-${index}`,
											startTimeUnixNano: String(base + 30_000_000_000n + BigInt(index)),
											endTimeUnixNano: String(base + 30_000_500_000n + BigInt(index)),
											status: { code: 1 },
										},
									],
								},
							],
						},
					],
				}),
			}),
		),
	);
	const interaction = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('.otelux-trace-row__button')];
    const loadMore = document.querySelector('.otelux-load-more');
    const heightBefore = document.querySelector('.otelux-trace-list__rows')?.style.height;
    const loadStarted = performance.now();
    loadMore?.click();
    for (let i=0;i<100 && document.querySelector('.otelux-trace-list__rows')?.style.height === heightBefore;i++) await new Promise(r=>setTimeout(r,10));
    const pagingMs = performance.now() - loadStarted;
    const before = performance.now();
    for (let i = 0; i < 50; i++) buttons[i % Math.min(buttons.length, 12)].click();
    const dispatchMs = performance.now() - before;
    await new Promise(r => setTimeout(r, 300));
    const deep = buttons.find(b => b.textContent.includes('perf-deep-root'));
    deep?.click();
    for (let i = 0; i < 100 && !document.querySelector('.otelux-waterfall'); i++) await new Promise(r => setTimeout(r, 20));
    const gaps=[]; let last=performance.now();
    for(let i=0;i<60;i++) await new Promise(r=>requestAnimationFrame(now=>{gaps.push(now-last);last=now;r()}));
    gaps.sort((a,b)=>a-b);
    return { dispatchMs, pagingMs, waterfallRows: document.querySelectorAll('.otelux-waterfall__row').length,
      waterfallDom: document.querySelector('.otelux-waterfall')?.querySelectorAll('*').length ?? 0,
      selected: document.querySelector('.otelux-waterfall__tid')?.textContent,
      frameP95: gaps[Math.floor(gaps.length*.95)], frameMax:gaps.at(-1) };
  })()`);
	const ingestResponses = await continuousIngest;
	if (ingestResponses.some((response) => response.status !== 200)) {
		throw new Error(
			`continuous ingest failed: ${ingestResponses.map((response) => response.status)}`,
		);
	}
	if (interaction.pagingMs >= 500)
		throw new Error(`cursor paging budget exceeded: ${interaction.pagingMs} ms`);
	if (interaction.waterfallRows >= 100 || interaction.waterfallDom >= 2_000)
		throw new Error(`waterfall budget exceeded: ${JSON.stringify(interaction)}`);
	if (!interaction.selected) throw new Error('selected waterfall did not render');

	await client.send('HeapProfiler.enable');
	await client.send('HeapProfiler.collectGarbage');
	const heap = await client.send('Runtime.getHeapUsage');
	const heapMb = heap.usedSize / 1024 / 1024;
	if (heapMb >= 100) throw new Error(`renderer heap budget exceeded: ${heapMb.toFixed(1)} MB`);

	console.log(
		JSON.stringify({ structural, interaction, heapMb: Number(heapMb.toFixed(1)) }, null, 2),
	);
	console.log('PERF SMOKE PASS');
} finally {
	client?.close();
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {}
	await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5_000)]);
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch {}
	rmSync(root, { recursive: true, force: true });
}
