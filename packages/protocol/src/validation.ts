import type {
	GetMetricPointsQuery,
	InvokeMessage,
	ListLogsQuery,
	ListMetricInstrumentsQuery,
	ListMetricsQuery,
	ListResourceFacetsQuery,
	ListTracesQuery,
	McpStatus,
	PartialSettings,
	ReceiverPressure,
	ReceiverStatus,
	RuntimeApiStatus,
	RuntimeEvent,
	RuntimeLockOwner,
	RuntimeState,
	Settings,
} from './index.js';

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const MAX_TEXT = 2_048;
const MAX_CURSOR = 512;
const MAX_FILTER_VALUES = 100;
const MAX_FILTER_VALUE = 512;

export class ProtocolValidationError extends Error {
	readonly code: string;
	readonly path: string;

	constructor(path: string, code: string, message: string) {
		super(`${path}: ${message}`);
		this.name = 'ProtocolValidationError';
		this.path = path;
		this.code = code;
	}
}

function fail(path: string, code: string, message: string): never {
	throw new ProtocolValidationError(path, code, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return fail(path, 'type', 'expected an object');
	}
	return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const set = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!set.has(key)) fail(`${path}.${key}`, 'unknown_field', 'field is not allowed');
	}
}

function string(value: unknown, path: string, maximum = MAX_TEXT): string {
	if (typeof value !== 'string') return fail(path, 'type', 'expected a string');
	if (value.length > maximum)
		return fail(path, 'max_length', `must be at most ${maximum} characters`);
	return value;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') return fail(path, 'type', 'expected a boolean');
	return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return fail(path, 'type', 'expected an integer');
	}
	if (value < minimum || value > maximum) {
		return fail(path, 'range', `must be between ${minimum} and ${maximum}`);
	}
	return value;
}

function bigint(value: unknown, path: string): bigint {
	if (typeof value !== 'bigint') return fail(path, 'type', 'expected a bigint');
	return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		return fail(path, 'enum', `expected one of ${allowed.join(', ')}`);
	}
	return value as T;
}

function stringArray(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value)) return fail(path, 'type', 'expected an array');
	if (value.length > MAX_FILTER_VALUES) {
		return fail(path, 'max_items', `must contain at most ${MAX_FILTER_VALUES} values`);
	}
	return value.map((item, index) => string(item, `${path}[${index}]`, MAX_FILTER_VALUE));
}

function optional<T>(
	value: Record<string, unknown>,
	key: string,
	decode: (input: unknown, path: string) => T,
	path: string,
): { readonly present: false } | { readonly present: true; readonly value: T } {
	if (!(key in value)) return { present: false };
	if (value[key] === undefined)
		return fail(`${path}.${key}`, 'type', 'explicit undefined is not allowed');
	return { present: true, value: decode(value[key], `${path}.${key}`) };
}

function assign<T extends object, K extends string, V>(
	target: T,
	key: K,
	decoded: { readonly present: false } | { readonly present: true; readonly value: V },
): asserts target is T & Record<K, V> {
	if (decoded.present) Object.assign(target, { [key]: decoded.value });
}

export function parseListTracesQuery(value: unknown, path = '$.query'): ListTracesQuery {
	const input = object(value, path);
	knownKeys(
		input,
		[
			'limit',
			'offset',
			'cursor',
			'includeTotalCount',
			'sortBy',
			'sortDirection',
			'timeFromUnixNano',
			'timeToUnixNano',
			'sources',
			'services',
			'hasError',
			'search',
		],
		path,
	);
	const result: Record<string, unknown> = {};
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 200), path),
	);
	assign(
		result,
		'offset',
		optional(input, 'offset', (v, p) => integer(v, p, 0, 10_000_000), path),
	);
	assign(
		result,
		'cursor',
		optional(input, 'cursor', (v, p) => string(v, p, MAX_CURSOR), path),
	);
	assign(result, 'includeTotalCount', optional(input, 'includeTotalCount', boolean, path));
	assign(
		result,
		'sortBy',
		optional(
			input,
			'sortBy',
			(v, p) => enumeration(v, ['startTime', 'name', 'duration', 'spanCount', 'errorCount'], p),
			path,
		),
	);
	assign(
		result,
		'sortDirection',
		optional(input, 'sortDirection', (v, p) => enumeration(v, ['asc', 'desc'], p), path),
	);
	assign(result, 'timeFromUnixNano', optional(input, 'timeFromUnixNano', bigint, path));
	assign(result, 'timeToUnixNano', optional(input, 'timeToUnixNano', bigint, path));
	assign(result, 'sources', optional(input, 'sources', stringArray, path));
	assign(result, 'services', optional(input, 'services', stringArray, path));
	assign(result, 'hasError', optional(input, 'hasError', boolean, path));
	assign(result, 'search', optional(input, 'search', string, path));
	return result as ListTracesQuery;
}

export function parseListLogsQuery(value: unknown, path = '$.query'): ListLogsQuery {
	const input = object(value, path);
	knownKeys(
		input,
		[
			'limit',
			'offset',
			'cursor',
			'includeTotalCount',
			'sortBy',
			'sortDirection',
			'timeFromUnixNano',
			'timeToUnixNano',
			'minSeverity',
			'sources',
			'services',
			'scopes',
			'traceId',
			'search',
		],
		path,
	);
	const result: Record<string, unknown> = {};
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 500), path),
	);
	assign(
		result,
		'offset',
		optional(input, 'offset', (v, p) => integer(v, p, 0, 10_000_000), path),
	);
	assign(
		result,
		'cursor',
		optional(input, 'cursor', (v, p) => string(v, p, MAX_CURSOR), path),
	);
	assign(result, 'includeTotalCount', optional(input, 'includeTotalCount', boolean, path));
	assign(
		result,
		'sortBy',
		optional(input, 'sortBy', (v, p) => enumeration(v, ['time', 'severity'], p), path),
	);
	assign(
		result,
		'sortDirection',
		optional(input, 'sortDirection', (v, p) => enumeration(v, ['asc', 'desc'], p), path),
	);
	assign(result, 'timeFromUnixNano', optional(input, 'timeFromUnixNano', bigint, path));
	assign(result, 'timeToUnixNano', optional(input, 'timeToUnixNano', bigint, path));
	assign(
		result,
		'minSeverity',
		optional(input, 'minSeverity', (v, p) => integer(v, p, 0, 24), path),
	);
	assign(result, 'sources', optional(input, 'sources', stringArray, path));
	assign(result, 'services', optional(input, 'services', stringArray, path));
	assign(result, 'scopes', optional(input, 'scopes', stringArray, path));
	assign(
		result,
		'traceId',
		optional(input, 'traceId', (v, p) => identifier(v, p, TRACE_ID, 'trace ID'), path),
	);
	assign(result, 'search', optional(input, 'search', string, path));
	return result as ListLogsQuery;
}

export function parseListMetricInstrumentsQuery(
	value: unknown,
	path = '$.query',
): ListMetricInstrumentsQuery {
	const input = object(value, path);
	knownKeys(input, ['limit', 'offset', 'sources', 'services', 'meters', 'search'], path);
	const result: Record<string, unknown> = {};
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 500), path),
	);
	assign(
		result,
		'offset',
		optional(input, 'offset', (v, p) => integer(v, p, 0, 10_000_000), path),
	);
	assign(result, 'sources', optional(input, 'sources', stringArray, path));
	assign(result, 'services', optional(input, 'services', stringArray, path));
	assign(result, 'meters', optional(input, 'meters', stringArray, path));
	assign(result, 'search', optional(input, 'search', string, path));
	return result as ListMetricInstrumentsQuery;
}

export function parseGetMetricPointsQuery(value: unknown, path = '$.query'): GetMetricPointsQuery {
	const input = object(value, path);
	knownKeys(input, ['instrumentId', 'limit', 'cursor'], path);
	const instrumentId = string(input.instrumentId, `${path}.instrumentId`, 32);
	if (!/^[1-9]\d*$/.test(instrumentId)) {
		return fail(`${path}.instrumentId`, 'format', 'expected a decimal instrument ID');
	}
	const result: Record<string, unknown> = { instrumentId };
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 1_000), path),
	);
	assign(
		result,
		'cursor',
		optional(
			input,
			'cursor',
			(value, cursorPath) => {
				const cursor = string(value, cursorPath, 128);
				if (!/^\d+:\d+$/.test(cursor)) {
					return fail(cursorPath, 'format', 'expected an opaque metric point cursor');
				}
				return cursor;
			},
			path,
		),
	);
	return result as unknown as GetMetricPointsQuery;
}

export function parseListMetricsQuery(value: unknown, path = '$.query'): ListMetricsQuery {
	const input = object(value, path);
	knownKeys(
		input,
		['limit', 'offset', 'pointLimit', 'sources', 'services', 'meters', 'search'],
		path,
	);
	const result: Record<string, unknown> = {};
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 500), path),
	);
	assign(
		result,
		'offset',
		optional(input, 'offset', (v, p) => integer(v, p, 0, 10_000_000), path),
	);
	assign(
		result,
		'pointLimit',
		optional(input, 'pointLimit', (v, p) => integer(v, p, 1, 10_000), path),
	);
	assign(result, 'sources', optional(input, 'sources', stringArray, path));
	assign(result, 'services', optional(input, 'services', stringArray, path));
	assign(result, 'meters', optional(input, 'meters', stringArray, path));
	assign(result, 'search', optional(input, 'search', string, path));
	return result as ListMetricsQuery;
}

export function parseListResourceFacetsQuery(
	value: unknown,
	path = '$.query',
): ListResourceFacetsQuery {
	const input = object(value, path);
	knownKeys(input, ['signal', 'facet', 'sources', 'limit'], path);
	const result: Record<string, unknown> = {
		signal: enumeration(input.signal, ['traces', 'logs', 'metrics'], `${path}.signal`),
		facet: enumeration(input.facet, ['source', 'service'], `${path}.facet`),
	};
	assign(result, 'sources', optional(input, 'sources', stringArray, path));
	assign(
		result,
		'limit',
		optional(input, 'limit', (v, p) => integer(v, p, 1, 500), path),
	);
	return result as unknown as ListResourceFacetsQuery;
}

function identifier(value: unknown, path: string, pattern: RegExp, label: string): string {
	const decoded = string(value, path, 64);
	if (!pattern.test(decoded))
		return fail(path, 'format', `expected a lowercase hexadecimal ${label}`);
	return decoded;
}

function parseTraceQuery(value: unknown, path: string): { traceId: string } {
	const input = object(value, path);
	knownKeys(input, ['traceId'], path);
	return { traceId: identifier(input.traceId, `${path}.traceId`, TRACE_ID, 'trace ID') };
}

function parseLogQuery(value: unknown, path: string): { logId: string } {
	const input = object(value, path);
	knownKeys(input, ['logId'], path);
	const logId = string(input.logId, `${path}.logId`, 32);
	if (!/^[1-9]\d*$/.test(logId)) return fail(`${path}.logId`, 'format', 'expected a decimal log ID');
	return { logId };
}

function parseSpanQuery(value: unknown, path: string): { traceId: string; spanId: string } {
	const input = object(value, path);
	knownKeys(input, ['traceId', 'spanId'], path);
	return {
		traceId: identifier(input.traceId, `${path}.traceId`, TRACE_ID, 'trace ID'),
		spanId: identifier(input.spanId, `${path}.spanId`, SPAN_ID, 'span ID'),
	};
}

export function parsePartialSettings(value: unknown, path = '$.patch'): PartialSettings {
	const input = object(value, path);
	knownKeys(input, ['otlp', 'mcp', 'retention', 'storage'], path);
	const result: Record<string, unknown> = {};
	if ('otlp' in input) {
		const section = object(input.otlp, `${path}.otlp`);
		knownKeys(section, ['port'], `${path}.otlp`);
		const output: Record<string, unknown> = {};
		assign(
			output,
			'port',
			optional(section, 'port', (v, p) => integer(v, p, 1, 65_535), `${path}.otlp`),
		);
		result.otlp = output;
	}
	if ('mcp' in input) {
		const section = object(input.mcp, `${path}.mcp`);
		knownKeys(section, ['enabled', 'port'], `${path}.mcp`);
		const output: Record<string, unknown> = {};
		assign(output, 'enabled', optional(section, 'enabled', boolean, `${path}.mcp`));
		assign(
			output,
			'port',
			optional(section, 'port', (v, p) => integer(v, p, 1, 65_535), `${path}.mcp`),
		);
		result.mcp = output;
	}
	if ('retention' in input) {
		const section = object(input.retention, `${path}.retention`);
		knownKeys(section, ['maxAgeHours', 'maxSizeMb'], `${path}.retention`);
		const output: Record<string, unknown> = {};
		assign(
			output,
			'maxAgeHours',
			optional(section, 'maxAgeHours', (v, p) => integer(v, p, 0, 43_800), `${path}.retention`),
		);
		assign(
			output,
			'maxSizeMb',
			optional(section, 'maxSizeMb', (v, p) => integer(v, p, 0, 1_048_576), `${path}.retention`),
		);
		result.retention = output;
	}
	if ('storage' in input) {
		const section = object(input.storage, `${path}.storage`);
		knownKeys(section, ['dbPath'], `${path}.storage`);
		const output: Record<string, unknown> = {};
		assign(
			output,
			'dbPath',
			optional(section, 'dbPath', (v, p) => string(v, p, 4_096), `${path}.storage`),
		);
		result.storage = output;
	}
	return result as PartialSettings;
}

export function parseSettings(value: unknown, path = '$.settings'): Settings {
	const input = object(value, path);
	knownKeys(input, ['version', 'otlp', 'mcp', 'retention', 'storage'], path);
	if (input.version !== 1) fail(`${path}.version`, 'literal', 'expected 1');
	const patchInput: Record<string, unknown> = {};
	for (const section of ['otlp', 'mcp', 'retention', 'storage']) {
		if (section in input) patchInput[section] = input[section];
	}
	const patch = parsePartialSettings(patchInput, path) as Record<string, unknown>;
	for (const section of ['otlp', 'mcp', 'retention', 'storage']) {
		if (!(section in input)) fail(`${path}.${section}`, 'required', 'field is required');
	}
	const result = { version: 1, ...patch } as Settings;
	if (result.otlp.port === undefined) fail(`${path}.otlp.port`, 'required', 'field is required');
	if (result.mcp.enabled === undefined) fail(`${path}.mcp.enabled`, 'required', 'field is required');
	if (result.mcp.port === undefined) fail(`${path}.mcp.port`, 'required', 'field is required');
	if (result.retention.maxAgeHours === undefined)
		fail(`${path}.retention.maxAgeHours`, 'required', 'field is required');
	if (result.retention.maxSizeMb === undefined)
		fail(`${path}.retention.maxSizeMb`, 'required', 'field is required');
	if (result.storage.dbPath === undefined)
		fail(`${path}.storage.dbPath`, 'required', 'field is required');
	return result;
}

export function parseReceiverStatus(value: unknown, path = '$.status'): ReceiverStatus {
	const input = object(value, path);
	const kind = enumeration(input.kind, ['starting', 'running', 'error'], `${path}.kind`);
	if (kind === 'starting') {
		knownKeys(input, ['kind'], path);
		return { kind };
	}
	knownKeys(
		input,
		kind === 'running' ? ['kind', 'port', 'host', 'pressure'] : ['kind', 'port', 'host', 'message'],
		path,
	);
	const base = {
		kind,
		port: integer(input.port, `${path}.port`, 1, 65_535),
		host: string(input.host, `${path}.host`, 255),
	};
	if (kind === 'error')
		return { ...base, kind, message: string(input.message, `${path}.message`, 2_048) };
	const pressure =
		'pressure' in input ? parseReceiverPressure(input.pressure, `${path}.pressure`) : undefined;
	return { ...base, kind, ...(pressure ? { pressure } : {}) };
}

function parseReceiverPressure(value: unknown, path: string): ReceiverPressure {
	const input = object(value, path);
	knownKeys(input, ['overloadedTraces', 'overloadedLogs', 'overloadedMetrics'], path);
	return {
		overloadedTraces: integer(
			input.overloadedTraces,
			`${path}.overloadedTraces`,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		overloadedLogs: integer(
			input.overloadedLogs,
			`${path}.overloadedLogs`,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		overloadedMetrics: integer(
			input.overloadedMetrics,
			`${path}.overloadedMetrics`,
			0,
			Number.MAX_SAFE_INTEGER,
		),
	};
}

export function parseMcpStatus(value: unknown, path = '$.mcpStatus'): McpStatus {
	const input = object(value, path);
	const kind = enumeration(input.kind, ['starting', 'running', 'disabled', 'error'], `${path}.kind`);
	if (kind === 'starting' || kind === 'disabled') {
		knownKeys(input, ['kind'], path);
		return { kind };
	}
	knownKeys(
		input,
		kind === 'running' ? ['kind', 'port', 'host'] : ['kind', 'port', 'host', 'message'],
		path,
	);
	const base = {
		kind,
		port: integer(input.port, `${path}.port`, 1, 65_535),
		host: string(input.host, `${path}.host`, 255),
	};
	return kind === 'error'
		? { ...base, kind, message: string(input.message, `${path}.message`, 2_048) }
		: { ...base, kind };
}

export function parseInvokeMessage(value: unknown): InvokeMessage {
	const input = object(value, '$');
	const kind = string(input.kind, '$.kind', 64);
	const queryMessage = (decoder: (value: unknown, path: string) => unknown): InvokeMessage => {
		knownKeys(input, ['kind', 'query'], '$');
		return { kind, query: decoder(input.query, '$.query') } as InvokeMessage;
	};
	switch (kind) {
		case 'listTraces':
			return queryMessage(parseListTracesQuery);
		case 'getTrace':
		case 'getTraceWaterfall':
			return queryMessage(parseTraceQuery);
		case 'getSpanDetails':
			return queryMessage(parseSpanQuery);
		case 'listLogs':
			return queryMessage(parseListLogsQuery);
		case 'getLogDetails':
			return queryMessage(parseLogQuery);
		case 'listMetricInstruments':
			return queryMessage(parseListMetricInstrumentsQuery);
		case 'getMetricPoints':
			return queryMessage(parseGetMetricPointsQuery);
		case 'listResourceFacets':
			return queryMessage(parseListResourceFacetsQuery);
		case 'updateSettings':
			knownKeys(input, ['kind', 'patch'], '$');
			return { kind, patch: parsePartialSettings(input.patch) };
		case 'getSettings':
		case 'getReceiverStatus':
		case 'getMcpStatus':
		case 'getStoragePath':
		case 'getStorageUsage':
		case 'loadSampleData':
		case 'clearData':
			knownKeys(input, ['kind'], '$');
			return { kind };
		default:
			return fail('$.kind', 'discriminator', 'unknown invoke message kind');
	}
}

function isoDate(value: unknown, path: string): string {
	const decoded = string(value, path, 64);
	if (!Number.isFinite(Date.parse(decoded))) {
		return fail(path, 'date_time', 'expected an ISO-8601 date-time');
	}
	return decoded;
}

export function parseRuntimeLockOwner(value: unknown, path = '$'): RuntimeLockOwner {
	const input = object(value, path);
	if (input.version !== 1) fail(`${path}.version`, 'literal', 'expected 1');
	return {
		version: 1,
		instanceId: string(input.instanceId, `${path}.instanceId`, 128),
		pid: integer(input.pid, `${path}.pid`, 1, Number.MAX_SAFE_INTEGER),
		acquiredAt: isoDate(input.acquiredAt, `${path}.acquiredAt`),
	};
}

export function parseRuntimeState(value: unknown, path = '$'): RuntimeState {
	const input = object(value, path);
	if (input.version !== 1) fail(`${path}.version`, 'literal', 'expected 1');
	return {
		version: 1,
		runtimeVersion: string(input.runtimeVersion, `${path}.runtimeVersion`, 64),
		protocolVersion: string(input.protocolVersion, `${path}.protocolVersion`, 64),
		instanceId: string(input.instanceId, `${path}.instanceId`, 128),
		pid: integer(input.pid, `${path}.pid`, 1, Number.MAX_SAFE_INTEGER),
		startedAt: isoDate(input.startedAt, `${path}.startedAt`),
		dataDirectory: string(input.dataDirectory, `${path}.dataDirectory`, 4_096),
		databasePath: string(input.databasePath, `${path}.databasePath`, 4_096),
		mcpTokenFile: string(input.mcpTokenFile, `${path}.mcpTokenFile`, 4_096),
		...('runtimeTokenFile' in input
			? { runtimeTokenFile: string(input.runtimeTokenFile, `${path}.runtimeTokenFile`, 4_096) }
			: {}),
		receiver: parseReceiverStatus(input.receiver, `${path}.receiver`),
		mcp: parseMcpStatus(input.mcp, `${path}.mcp`),
		...('api' in input ? { api: parseRuntimeApiStatus(input.api, `${path}.api`) } : {}),
	};
}

export function parseRuntimeApiStatus(value: unknown, path = '$.api'): RuntimeApiStatus {
	const input = object(value, path);
	const kind = enumeration(input.kind, ['starting', 'running', 'error'], `${path}.kind`);
	if (kind === 'starting') {
		knownKeys(input, ['kind'], path);
		return { kind };
	}
	knownKeys(
		input,
		kind === 'running' ? ['kind', 'host', 'port'] : ['kind', 'host', 'port', 'message'],
		path,
	);
	const base = {
		kind,
		host: string(input.host, `${path}.host`, 255),
		port: integer(input.port, `${path}.port`, 1, 65_535),
	};
	return kind === 'error'
		? { ...base, kind, message: string(input.message, `${path}.message`, 2_048) }
		: { ...base, kind };
}

export function parseRuntimeEvent(value: unknown): RuntimeEvent {
	const input = object(value, '$');
	const kind = string(input.kind, '$.kind', 64);
	switch (kind) {
		case 'tracesChanged':
			knownKeys(input, ['kind', 'traceIds'], '$');
			if (!Array.isArray(input.traceIds) || input.traceIds.length > 1_000)
				fail('$.traceIds', 'type', 'expected at most 1000 trace IDs');
			return {
				kind,
				traceIds: input.traceIds.map((id, index) =>
					identifier(id, `$.traceIds[${index}]`, TRACE_ID, 'trace ID'),
				),
			};
		case 'logsChanged':
		case 'metricsChanged':
			knownKeys(input, ['kind', 'count'], '$');
			return { kind, count: integer(input.count, '$.count', 0, Number.MAX_SAFE_INTEGER) };
		case 'settings-changed':
			knownKeys(input, ['kind', 'settings'], '$');
			return { kind, settings: parseSettings(input.settings) };
		case 'receiver-status-changed':
			knownKeys(input, ['kind', 'status'], '$');
			return { kind, status: parseReceiverStatus(input.status) };
		case 'mcp-status-changed':
			knownKeys(input, ['kind', 'status'], '$');
			return { kind, status: parseMcpStatus(input.status) };
		case 'api-status-changed':
			knownKeys(input, ['kind', 'status'], '$');
			return { kind, status: parseRuntimeApiStatus(input.status) };
		default:
			return fail('$.kind', 'discriminator', 'unknown runtime event kind');
	}
}
