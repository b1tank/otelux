import type {
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListTracesQuery,
	ListTracesResult,
	LoadSampleDataResult,
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	RuntimeEvent,
	Settings,
	SpanDetails,
	StoragePathInfo,
	StorageUsageInfo,
	UpdateSettingsResult,
} from '@otelux/protocol';
export type {
	LoadSampleDataResult,
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	Settings,
	StoragePathInfo,
	StorageUsageInfo,
	UpdateSettingsResult,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';

/**
 * Single IPC request channel name. All renderer→main calls go through one
 * tagged-union channel so we never have to register/remove handlers as
 * the protocol grows.
 */
export const OTELUX_INVOKE_CHANNEL = 'otelux:invoke';

/**
 * Push channel for main→renderer events. The main process broadcasts on
 * this channel when the engine, settings, or receiver status change.
 */
export const OTELUX_EVENT_CHANNEL = 'otelux:event';

/**
 * Discriminated union of every renderer→main call. Add a new kind here
 * and the main-side dispatcher will fail to compile until it handles it.
 */
export type InvokeMessage =
	| { kind: 'listTraces'; query: ListTracesQuery }
	| { kind: 'getTrace'; query: GetTraceQuery }
	| { kind: 'getSpanDetails'; query: GetSpanDetailsQuery }
	| { kind: 'listLogs'; query: ListLogsQuery }
	| { kind: 'listMetrics'; query: ListMetricsQuery }
	| { kind: 'getSettings' }
	| { kind: 'updateSettings'; patch: PartialSettings }
	| { kind: 'getReceiverStatus' }
	| { kind: 'getMcpStatus' }
	| { kind: 'getStoragePath' }
	| { kind: 'getStorageUsage' }
	| { kind: 'loadSampleData' }
	| { kind: 'clearData' };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: M extends { kind: 'listLogs' }
				? ListLogsResult
				: M extends { kind: 'listMetrics' }
					? ListMetricsResult
					: M extends { kind: 'getSettings' }
						? Settings
						: M extends { kind: 'updateSettings' }
							? UpdateSettingsResult
							: M extends { kind: 'getReceiverStatus' }
								? ReceiverStatus
								: M extends { kind: 'getMcpStatus' }
									? McpStatus
									: M extends { kind: 'getStoragePath' }
										? StoragePathInfo
										: M extends { kind: 'getStorageUsage' }
											? StorageUsageInfo
											: M extends { kind: 'loadSampleData' }
												? LoadSampleDataResult
												: M extends { kind: 'clearData' }
													? undefined
													: never;

/**
 * Discriminated union of every main→renderer push. The existing engine
 * {@link ChangeEvent} (`kind: 'tracesChanged'`) is included verbatim so
 * the workbench's subscribe path keeps working.
 */
export type OteluxEvent = RuntimeEvent;
