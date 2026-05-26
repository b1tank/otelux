/**
 * Tool implementations frozen in `docs/spec.md` § 12.3.
 *
 * Each tool is a thin wrapper over `@otelux/engine` so the LM Tools in
 * `apps/vscode-extension` and these MCP tools return identical results.
 *
 * Three tools (`otel_search_logs`, `otel_correlate_agent_run`,
 * `otel_get_service_overview`) have stub implementations in M1 — the
 * engine surface they need lands later (logs in Phase 2, agent-run
 * detection in Phase 1 Track B, services overview in Phase 6). The
 * input schemas are frozen here so clients can integrate today and
 * pick up real data when the engine catches up.
 */

import type { ToolDefinition } from '../server.js';
import { findRecentErrorsTool } from './findRecentErrors.js';
import { getSlowestSpansTool } from './getSlowestSpans.js';
import { searchLogsTool } from './searchLogs.js';
import { correlateAgentRunTool } from './correlateAgentRun.js';
import { getTraceTool, getSpanDetailsTool } from './getTrace.js';
import { getServiceOverviewTool } from './getServiceOverview.js';

export const defaultTools: readonly ToolDefinition[] = [
	findRecentErrorsTool,
	getSlowestSpansTool,
	searchLogsTool,
	correlateAgentRunTool,
	getTraceTool,
	getSpanDetailsTool,
	getServiceOverviewTool,
];
