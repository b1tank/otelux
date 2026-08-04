import type { RuntimeEvent } from '@otelux/protocol';
export type {
	InvokeMessage,
	InvokeResultFor,
	LoadSampleDataResult,
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	Settings,
	StoragePathInfo,
	StorageUsageInfo,
	UpdateSettingsResult,
} from '@otelux/protocol';

/** Single renderer-to-main request channel. */
export const OTELUX_INVOKE_CHANNEL = 'otelux:invoke';

/** Main-to-renderer runtime event channel. */
export const OTELUX_EVENT_CHANNEL = 'otelux:event';

/** Every validated main-to-renderer push event. */
export type OteluxEvent = RuntimeEvent;
