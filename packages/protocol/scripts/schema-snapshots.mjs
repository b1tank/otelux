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
				runtimeTokenFile: text(4096),
				receiver: receiverStatus,
				mcp: mcpStatus,
				api: {
					oneOf: [
						object({ kind: { const: 'starting' } }),
						object({ kind: { const: 'running' }, host: text(255), port: integer(1, 65535) }),
						object({
							kind: { const: 'error' },
							host: text(255),
							port: integer(1, 65535),
							message: text(),
						}),
					],
				},
			},
			[
				'version',
				'runtimeVersion',
				'protocolVersion',
				'instanceId',
				'pid',
				'startedAt',
				'dataDirectory',
				'databasePath',
				'mcpTokenFile',
				'receiver',
				'mcp',
			],
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
const metricInstrumentListQuery = object(
	{
		limit: integer(1, 500),
		offset: integer(0, 10000000),
		sources: stringArray,
		services: stringArray,
		meters: stringArray,
		search: text(),
	},
	[],
);
const metricPointsQuery = object(
	{
		instrumentId: text(32, '^[1-9][0-9]*$'),
		limit: integer(1, 1000),
		cursor: text(128, '^[0-9]+:[0-9]+$'),
	},
	['instrumentId'],
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
const logQuery = object({ logId: text(32, '^[1-9][0-9]*$') }, ['logId']);
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
		queryRequest('getLogDetails', logQuery),
		queryRequest('listMetricInstruments', metricInstrumentListQuery),
		queryRequest('getMetricPoints', metricPointsQuery),
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

schemas['runtime-rpc-request'] = {
	$schema: draft,
	$id: id('runtime-rpc-request'),
	title: 'OTelux Runtime JSON-RPC request',
	...object(
		{
			jsonrpc: { const: '2.0' },
			id: { type: ['string', 'number', 'null'] },
			method: {
				enum: [
					'runtime/initialize',
					'runtime/getStatus',
					'runtime/getSettings',
					'runtime/updateSettings',
					'runtime/loadSampleData',
					'runtime/clearData',
					'telemetry/listTraces',
					'telemetry/getTrace',
					'telemetry/getTraceWaterfall',
					'telemetry/getSpan',
					'telemetry/listLogs',
					'telemetry/getLog',
					'telemetry/listMetricInstruments',
					'telemetry/getMetricPoints',
					'telemetry/getFacets',
				],
			},
			params: {},
		},
		['jsonrpc', 'method'],
	),
};
schemas['runtime-rpc-response'] = {
	$schema: draft,
	$id: id('runtime-rpc-response'),
	title: 'OTelux Runtime JSON-RPC response',
	oneOf: [
		object({ jsonrpc: { const: '2.0' }, id: { type: ['string', 'number', 'null'] }, result: {} }),
		object({
			jsonrpc: { const: '2.0' },
			id: { type: ['string', 'number', 'null'] },
			error: object({ code: { type: 'integer' }, message: text(), data: {} }, ['code', 'message']),
		}),
	],
};
schemas['runtime-sse-event'] = {
	$schema: draft,
	$id: id('runtime-sse-event'),
	title: 'OTelux Runtime SSE event envelope',
	oneOf: [
		object(
			{
				schemaVersion: { const: 1 },
				revision: text(128, '^(0|[1-9][0-9]*)$'),
				kind: { const: 'telemetry.changed' },
				signals: {
					type: 'array',
					minItems: 1,
					maxItems: 5,
					uniqueItems: true,
					items: { enum: ['traces', 'logs', 'metrics', 'settings', 'status'] },
				},
				traceIds: { type: 'array', maxItems: 1000, items: traceId },
			},
			['schemaVersion', 'revision', 'kind', 'signals'],
		),
		object({
			schemaVersion: { const: 1 },
			revision: text(128, '^(0|[1-9][0-9]*)$'),
			kind: { const: 'runtime.resync' },
			signals: {
				type: 'array',
				minItems: 1,
				maxItems: 5,
				uniqueItems: true,
				items: { enum: ['traces', 'logs', 'metrics', 'settings', 'status'] },
			},
		}),
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
		object({
			kind: { const: 'api-status-changed' },
			status: {
				oneOf: [
					object({ kind: { const: 'starting' } }),
					object({ kind: { const: 'running' }, host: text(255), port: integer(1, 65535) }),
					object({
						kind: { const: 'error' },
						host: text(255),
						port: integer(1, 65535),
						message: text(),
					}),
				],
			},
		}),
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
