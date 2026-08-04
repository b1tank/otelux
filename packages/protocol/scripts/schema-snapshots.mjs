#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'schema', 'v1');
const draft = 'https://json-schema.org/draft/2020-12/schema';
const id = (name) => `https://otelux.dev/schema/v1/${name}.schema.json`;
const object = (properties, required = Object.keys(properties), additionalProperties = false) => ({
	type: 'object',
	properties,
	required,
	additionalProperties,
});
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const text = (maxLength, pattern) => ({
	type: 'string',
	maxLength: maxLength ?? 2048,
	...(pattern ? { pattern } : {}),
});
const stringArray = {
	type: 'array',
	maxItems: 100,
	items: text(512),
};
const traceId = text(32, '^[0-9a-f]{32}$');
const spanId = text(16, '^[0-9a-f]{16}$');
const bigintStructuredClone = { description: 'JavaScript bigint on Electron structured-clone IPC' };
const pressure = object({
	overloadedTraces: integer(0, Number.MAX_SAFE_INTEGER),
	overloadedLogs: integer(0, Number.MAX_SAFE_INTEGER),
	overloadedMetrics: integer(0, Number.MAX_SAFE_INTEGER),
});
const receiverStatus = {
	oneOf: [
		object({ kind: { const: 'starting' } }),
		object(
			{
				kind: { const: 'running' },
				port: integer(1, 65535),
				host: text(255),
				pressure,
			},
			['kind', 'port', 'host'],
		),
		object({
			kind: { const: 'error' },
			port: integer(1, 65535),
			host: text(255),
			message: text(),
		}),
	],
};
const mcpStatus = {
	oneOf: [
		object({ kind: { const: 'starting' } }),
		object({ kind: { const: 'disabled' } }),
		object({ kind: { const: 'running' }, port: integer(1, 65535), host: text(255) }),
		object({
			kind: { const: 'error' },
			port: integer(1, 65535),
			host: text(255),
			message: text(),
		}),
	],
};
const partialSettings = object(
	{
		otlp: object({ port: integer(1, 65535) }, [], false),
		mcp: object({ enabled: { type: 'boolean' }, port: integer(1, 65535) }, [], false),
		retention: object(
			{
				maxAgeHours: integer(0, 43800),
				maxSizeMb: integer(0, 1048576),
			},
			[],
			false,
		),
		storage: object({ dbPath: text(4096) }, [], false),
	},
	[],
	false,
);
const settings = object({
	version: { const: 1 },
	otlp: object({ port: integer(1, 65535) }),
	mcp: object({ enabled: { type: 'boolean' }, port: integer(1, 65535) }),
	retention: object({
		maxAgeHours: integer(0, 43800),
		maxSizeMb: integer(0, 1048576),
	}),
	storage: object({ dbPath: text(4096) }),
});

const schemas = {
	'tagged-bigint': {
		$schema: draft,
		$id: id('tagged-bigint'),
		title: 'OTelux tagged bigint',
		...object({ $bigint: text(1024, '^-?(0|[1-9][0-9]*)$') }),
	},
	'runtime-state': {
		$schema: draft,
		$id: id('runtime-state'),
		title: 'OTelux runtime discovery state v1',
		...object(
			{
				version: { const: 1 },
				runtimeVersion: text(64),
				protocolVersion: text(64),
				instanceId: text(128),
				pid: integer(1, Number.MAX_SAFE_INTEGER),
				startedAt: { type: 'string', format: 'date-time', maxLength: 64 },
				dataDirectory: text(4096),
				databasePath: text(4096),
				mcpTokenFile: text(4096),
				receiver: receiverStatus,
				mcp: mcpStatus,
			},
			undefined,
			true,
		),
	},
};

const traceQuery = object({ traceId });
const spanQuery = object({ traceId, spanId });
const traceListQuery = object(
	{
		limit: integer(1, 200),
		offset: integer(0, 10000000),
		cursor: text(512),
		includeTotalCount: { type: 'boolean' },
		sortBy: { enum: ['startTime', 'name', 'duration', 'spanCount', 'errorCount'] },
		sortDirection: { enum: ['asc', 'desc'] },
		timeFromUnixNano: bigintStructuredClone,
		timeToUnixNano: bigintStructuredClone,
		sources: stringArray,
		services: stringArray,
		hasError: { type: 'boolean' },
		search: text(),
	},
	[],
);
const logListQuery = object(
	{
		limit: integer(1, 500),
		offset: integer(0, 10000000),
		cursor: text(512),
		includeTotalCount: { type: 'boolean' },
		sortBy: { enum: ['time', 'severity'] },
		sortDirection: { enum: ['asc', 'desc'] },
		timeFromUnixNano: bigintStructuredClone,
		timeToUnixNano: bigintStructuredClone,
		minSeverity: integer(0, 24),
		sources: stringArray,
		services: stringArray,
		scopes: stringArray,
		traceId,
		search: text(),
	},
	[],
);
const metricListQuery = object(
	{
		limit: integer(1, 500),
		offset: integer(0, 10000000),
		pointLimit: integer(1, 10000),
		sources: stringArray,
		services: stringArray,
		meters: stringArray,
		search: text(),
	},
	[],
);
const facetQuery = object(
	{
		signal: { enum: ['traces', 'logs', 'metrics'] },
		facet: { enum: ['source', 'service'] },
		sources: stringArray,
		limit: integer(1, 500),
	},
	['signal', 'facet'],
);
const queryRequest = (kind, query) => object({ kind: { const: kind }, query });
const emptyRequest = (kind) => object({ kind: { const: kind } });
schemas['invoke-message'] = {
	$schema: draft,
	$id: id('invoke-message'),
	title: 'OTelux Electron invoke message',
	oneOf: [
		queryRequest('listTraces', traceListQuery),
		queryRequest('getTrace', traceQuery),
		queryRequest('getTraceWaterfall', traceQuery),
		queryRequest('getSpanDetails', spanQuery),
		queryRequest('listLogs', logListQuery),
		queryRequest('listMetrics', metricListQuery),
		queryRequest('listResourceFacets', facetQuery),
		object({ kind: { const: 'updateSettings' }, patch: partialSettings }),
		...[
			'getSettings',
			'getReceiverStatus',
			'getMcpStatus',
			'getStoragePath',
			'getStorageUsage',
			'loadSampleData',
			'clearData',
		].map(emptyRequest),
	],
};

schemas['runtime-event'] = {
	$schema: draft,
	$id: id('runtime-event'),
	title: 'OTelux runtime event',
	oneOf: [
		object({
			kind: { const: 'tracesChanged' },
			traceIds: { type: 'array', maxItems: 1000, items: traceId },
		}),
		object({ kind: { const: 'logsChanged' }, count: integer(0, Number.MAX_SAFE_INTEGER) }),
		object({ kind: { const: 'metricsChanged' }, count: integer(0, Number.MAX_SAFE_INTEGER) }),
		object({ kind: { const: 'settings-changed' }, settings }),
		object({ kind: { const: 'receiver-status-changed' }, status: receiverStatus }),
		object({ kind: { const: 'mcp-status-changed' }, status: mcpStatus }),
	],
};

mkdirSync(outputDirectory, { recursive: true });
const check = process.argv.includes('--check');
let stale = false;
for (const [name, schema] of Object.entries(schemas)) {
	const path = join(outputDirectory, `${name}.schema.json`);
	const expected = `${JSON.stringify(schema, null, 2)}\n`;
	if (check) {
		let actual = '';
		try {
			actual = readFileSync(path, 'utf8');
		} catch {
			// Report the same actionable stale-snapshot error below.
		}
		if (actual !== expected) {
			console.error(`stale schema snapshot: ${path}`);
			stale = true;
		}
	} else {
		writeFileSync(path, expected);
		console.log(`wrote ${path}`);
	}
}
if (stale) {
	console.error('Run: node packages/protocol/scripts/schema-snapshots.mjs');
	process.exit(1);
}
