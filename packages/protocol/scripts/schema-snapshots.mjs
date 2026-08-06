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
	revision: integer(0, Number.MAX_SAFE_INTEGER),
	otlp: object({ port: integer(1, 65535) }),
	mcp: object({ enabled: { type: 'boolean' }, port: integer(1, 65535) }),
	retention: object({
		maxAgeHours: integer(0, 43800),
		maxSizeMb: integer(0, 1048576),
	}),
	storage: object({ dbPath: text(4096) }),
});
const taggedBigint = { $ref: id('tagged-bigint') };
const finiteNumber = { type: 'number' };
const attributeScalar = { oneOf: [text(1048576), finiteNumber, { type: 'boolean' }, taggedBigint] };
const attributeValue = {
	oneOf: [
		attributeScalar,
		...attributeScalar.oneOf.map((items) => ({ type: 'array', maxItems: 10000, items })),
	],
};
const attributes = {
	type: 'object',
	maxProperties: 10000,
	additionalProperties: attributeValue,
};
const resource = object(
	{ attributes, droppedAttributesCount: integer(0, Number.MAX_SAFE_INTEGER) },
	['attributes'],
);
const scope = object({ name: text(), version: text(), attributes }, ['name']);
const spanStatus = object({ code: { enum: [0, 1, 2] }, message: text() }, ['code']);
const spanEvent = object(
	{
		name: text(),
		timeUnixNano: taggedBigint,
		attributes,
		droppedAttributesCount: integer(0, Number.MAX_SAFE_INTEGER),
	},
	['name', 'timeUnixNano'],
);
const spanLink = object(
	{
		traceId,
		spanId,
		traceState: text(),
		attributes,
		droppedAttributesCount: integer(0, Number.MAX_SAFE_INTEGER),
	},
	['traceId', 'spanId'],
);
const span = object(
	{
		traceId,
		spanId,
		parentSpanId: spanId,
		name: text(),
		kind: { enum: [0, 1, 2, 3, 4, 5] },
		startTimeUnixNano: taggedBigint,
		endTimeUnixNano: taggedBigint,
		status: spanStatus,
		attributes,
		events: { type: 'array', maxItems: 10000, items: spanEvent },
		links: { type: 'array', maxItems: 10000, items: spanLink },
		traceState: text(),
		droppedAttributesCount: integer(0, Number.MAX_SAFE_INTEGER),
		droppedEventsCount: integer(0, Number.MAX_SAFE_INTEGER),
		droppedLinksCount: integer(0, Number.MAX_SAFE_INTEGER),
		resource,
		scope,
	},
	[
		'traceId',
		'spanId',
		'name',
		'kind',
		'startTimeUnixNano',
		'endTimeUnixNano',
		'status',
		'attributes',
		'resource',
		'scope',
	],
);
const trace = object(
	{
		traceId,
		rootSpan: span,
		spans: { type: 'array', maxItems: 100000, items: span },
		startTimeUnixNano: taggedBigint,
		endTimeUnixNano: taggedBigint,
		durationNanos: taggedBigint,
		services: { type: 'array', maxItems: 10000, items: text() },
		spanCount: integer(0, Number.MAX_SAFE_INTEGER),
		errorCount: integer(0, Number.MAX_SAFE_INTEGER),
	},
	[
		'traceId',
		'spans',
		'startTimeUnixNano',
		'endTimeUnixNano',
		'durationNanos',
		'services',
		'spanCount',
		'errorCount',
	],
);
const logRecord = object(
	{
		timeUnixNano: taggedBigint,
		observedTimeUnixNano: taggedBigint,
		severityNumber: integer(0, 24),
		severityText: text(),
		eventName: text(),
		body: attributeValue,
		attributes,
		droppedAttributesCount: integer(0, Number.MAX_SAFE_INTEGER),
		flags: integer(0, Number.MAX_SAFE_INTEGER),
		traceId,
		spanId,
		resource,
		scope,
	},
	['timeUnixNano', 'severityNumber', 'attributes', 'resource', 'scope'],
);
const numberPoint = object(
	{
		startTimeUnixNano: taggedBigint,
		timeUnixNano: taggedBigint,
		value: finiteNumber,
		attributes,
		flags: integer(0, Number.MAX_SAFE_INTEGER),
	},
	['timeUnixNano', 'value', 'attributes'],
);
const histogramPoint = object(
	{
		startTimeUnixNano: taggedBigint,
		timeUnixNano: taggedBigint,
		count: integer(0, Number.MAX_SAFE_INTEGER),
		sum: finiteNumber,
		min: finiteNumber,
		max: finiteNumber,
		bucketCounts: { type: 'array', maxItems: 10000, items: integer(0, Number.MAX_SAFE_INTEGER) },
		explicitBounds: { type: 'array', maxItems: 10000, items: finiteNumber },
		attributes,
		flags: integer(0, Number.MAX_SAFE_INTEGER),
	},
	['timeUnixNano', 'count', 'bucketCounts', 'explicitBounds', 'attributes'],
);
const metricCommon = { name: text(), description: text(), unit: text(), resource, scope };
const metric = {
	oneOf: [
		object(
			{
				...metricCommon,
				type: { const: 'gauge' },
				dataPoints: { type: 'array', maxItems: 1000, items: numberPoint },
			},
			['name', 'type', 'resource', 'scope', 'dataPoints'],
		),
		object(
			{
				...metricCommon,
				type: { const: 'sum' },
				isMonotonic: { type: 'boolean' },
				temporality: { enum: [0, 1, 2] },
				dataPoints: { type: 'array', maxItems: 1000, items: numberPoint },
			},
			['name', 'type', 'resource', 'scope', 'isMonotonic', 'temporality', 'dataPoints'],
		),
		object(
			{
				...metricCommon,
				type: { const: 'histogram' },
				temporality: { enum: [0, 1, 2] },
				dataPoints: { type: 'array', maxItems: 1000, items: histogramPoint },
			},
			['name', 'type', 'resource', 'scope', 'temporality', 'dataPoints'],
		),
	],
};
const resultSchema = (name, title, schema) => ({ $schema: draft, $id: id(name), title, ...schema });
const resultSchemas = {
	'result-runtime-initialize': resultSchema(
		'result-runtime-initialize',
		'runtime/initialize result',
		object({
			protocolVersion: { const: '2.0.0' },
			runtime: object({ name: { const: 'otelux-runtime' }, version: text(64) }),
			capabilities: object({
				queries: { const: true },
				settings: { const: true },
				sampleData: { const: true },
				clearData: { const: true },
				events: { const: true },
			}),
			limits: object({
				traces: { const: 200 },
				logs: { const: 500 },
				metrics: { const: 500 },
				metricPoints: { const: 1000 },
			}),
		}),
	),
	'result-runtime-status': resultSchema(
		'result-runtime-status',
		'runtime/getStatus result',
		object(
			{
				runtimeVersion: text(64),
				protocolVersion: text(64),
				instanceId: text(128),
				pid: integer(1, Number.MAX_SAFE_INTEGER),
				startedAt: { type: 'string', format: 'date-time', maxLength: 64 },
				dataDirectory: text(4096),
				databasePath: text(4096),
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
				'runtimeVersion',
				'protocolVersion',
				'instanceId',
				'pid',
				'startedAt',
				'dataDirectory',
				'databasePath',
				'receiver',
				'mcp',
			],
		),
	),
	'result-settings': resultSchema('result-settings', 'runtime/getSettings result', settings),
	'result-storage-path': resultSchema(
		'result-storage-path',
		'runtime/getStoragePath result',
		object({ activePath: text(4096), defaultPath: text(4096) }),
	),
	'result-storage-usage': resultSchema(
		'result-storage-usage',
		'runtime/getStorageUsage result',
		object({
			activePath: text(4096),
			retentionBytes: integer(0, Number.MAX_SAFE_INTEGER),
			databaseFileBytes: integer(0, Number.MAX_SAFE_INTEGER),
			walBytes: integer(0, Number.MAX_SAFE_INTEGER),
			sharedMemoryBytes: integer(0, Number.MAX_SAFE_INTEGER),
			totalBytes: integer(0, Number.MAX_SAFE_INTEGER),
		}),
	),
	'result-update-settings': resultSchema('result-update-settings', 'runtime/updateSettings result', {
		oneOf: [
			object({ ok: { const: true }, settings, status: receiverStatus, mcpStatus }),
			object({ ok: { const: false }, error: text() }),
			object({
				ok: { const: false },
				conflict: { const: true },
				error: text(),
				settings,
			}),
		],
	}),
	'result-load-sample-data': resultSchema(
		'result-load-sample-data',
		'runtime/loadSampleData result',
		object({
			traces: integer(0, Number.MAX_SAFE_INTEGER),
			logs: integer(0, Number.MAX_SAFE_INTEGER),
			metrics: integer(0, Number.MAX_SAFE_INTEGER),
		}),
	),
	'result-clear-data': resultSchema('result-clear-data', 'runtime/clearData result', {
		type: 'null',
	}),
	'result-shutdown': resultSchema('result-shutdown', 'runtime/shutdown result', {
		type: 'null',
	}),
	'result-list-traces': resultSchema(
		'result-list-traces',
		'telemetry/listTraces result',
		object(
			{
				rows: {
					type: 'array',
					maxItems: 200,
					items: object({
						traceId,
						rootName: text(),
						startTimeUnixNano: taggedBigint,
						durationNanos: taggedBigint,
						services: { type: 'array', maxItems: 10000, items: text() },
						spanCount: integer(0, Number.MAX_SAFE_INTEGER),
						errorCount: integer(0, Number.MAX_SAFE_INTEGER),
					}),
				},
				totalCount: integer(0, Number.MAX_SAFE_INTEGER),
				totalCountIsExact: { type: 'boolean' },
				nextCursor: text(512),
			},
			['rows', 'totalCount'],
		),
	),
	'result-trace': resultSchema('result-trace', 'telemetry trace result', trace),
	'result-span': resultSchema('result-span', 'telemetry/getSpan result', span),
	'result-list-logs': resultSchema(
		'result-list-logs',
		'telemetry/listLogs result',
		object(
			{
				rows: {
					type: 'array',
					maxItems: 500,
					items: object(
						{
							logId: text(32, '^[1-9][0-9]*$'),
							timeUnixNano: taggedBigint,
							severityNumber: integer(0, 24),
							severityText: text(),
							eventName: text(),
							message: text(4096),
							serviceName: text(),
							traceId,
							spanId,
						},
						['logId', 'timeUnixNano', 'severityNumber', 'message'],
					),
				},
				totalCount: integer(0, Number.MAX_SAFE_INTEGER),
				totalCountIsExact: { type: 'boolean' },
				nextCursor: text(512),
			},
			['rows', 'totalCount'],
		),
	),
	'result-log': resultSchema('result-log', 'telemetry/getLog result', logRecord),
	'result-list-metric-instruments': resultSchema(
		'result-list-metric-instruments',
		'telemetry/listMetricInstruments result',
		object({
			rows: {
				type: 'array',
				maxItems: 500,
				items: object(
					{
						instrumentId: text(32, '^[1-9][0-9]*$'),
						name: text(),
						description: text(),
						unit: text(),
						type: { enum: ['sum', 'gauge', 'histogram'] },
						isMonotonic: { type: 'boolean' },
						temporality: { enum: [0, 1, 2] },
						sourceName: text(),
						serviceName: text(),
						meterName: text(),
						pointCount: integer(0, Number.MAX_SAFE_INTEGER),
						latest: {
							oneOf: [
								object({ kind: { const: 'number' }, timeUnixNano: taggedBigint, value: finiteNumber }),
								object(
									{
										kind: { const: 'histogram' },
										timeUnixNano: taggedBigint,
										count: integer(0, Number.MAX_SAFE_INTEGER),
										sum: finiteNumber,
									},
									['kind', 'timeUnixNano', 'count'],
								),
							],
						},
					},
					['instrumentId', 'name', 'type', 'meterName', 'pointCount'],
				),
			},
			totalCount: integer(0, Number.MAX_SAFE_INTEGER),
		}),
	),
	'result-metric-points': resultSchema(
		'result-metric-points',
		'telemetry/getMetricPoints result',
		object(
			{
				metric,
				totalPointCount: integer(0, Number.MAX_SAFE_INTEGER),
				nextCursor: text(128),
				truncatedAttributes: {
					type: 'array',
					maxItems: 1000,
					items: object({
						pointIndex: integer(0, 999),
						truncatedOrOmittedAttributeCount: integer(0, Number.MAX_SAFE_INTEGER),
					}),
				},
				resourceAttributesTruncated: integer(0, Number.MAX_SAFE_INTEGER),
				scopeAttributesTruncated: integer(0, Number.MAX_SAFE_INTEGER),
				metadataTruncated: { type: 'boolean' },
				histogramBucketsTruncated: { type: 'array', maxItems: 1000, items: integer(0, 999) },
			},
			['metric', 'totalPointCount'],
		),
	),
	'result-facets': resultSchema(
		'result-facets',
		'telemetry/getFacets result',
		object({
			rows: {
				type: 'array',
				maxItems: 500,
				items: object({ name: text(512), count: integer(0, Number.MAX_SAFE_INTEGER) }),
			},
		}),
	),
};

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
		object({
			kind: { const: 'updateSettings' },
			patch: partialSettings,
			expectedRevision: integer(0, Number.MAX_SAFE_INTEGER),
		}),
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
					'runtime/getStoragePath',
					'runtime/getStorageUsage',
					'runtime/updateSettings',
					'runtime/loadSampleData',
					'runtime/clearData',
					'runtime/shutdown',
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

Object.assign(schemas, resultSchemas);

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
