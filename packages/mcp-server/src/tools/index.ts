/**
 * Tool implementations frozen in `docs/spec.md` § 12.3.
 *
 * Each tool is a thin wrapper over `@otelux/engine` so every MCP transport
 * returns identical results.
 *
 * `otel_correlate_agent_run` is schema-stable but waits on engine-side
 * agent-run detection. `otel_get_service_overview` is backed by recent trace
 * summaries today; richer cross-signal service rollups land later.
 */

import type { ToolDefinition } from '../server.js';
import { correlateAgentRunTool } from './correlateAgentRun.js';
import { findRecentErrorsTool } from './findRecentErrors.js';
import { getServiceOverviewTool } from './getServiceOverview.js';
import { getSlowestSpansTool } from './getSlowestSpans.js';
import { getSpanDetailsTool, getTraceTool } from './getTrace.js';
import { searchLogsTool } from './searchLogs.js';

export const defaultTools: readonly ToolDefinition[] = [
	findRecentErrorsTool,
	getSlowestSpansTool,
	searchLogsTool,
	correlateAgentRunTool,
	getTraceTool,
	getSpanDetailsTool,
	getServiceOverviewTool,
];
