/**
 * Tool implementations frozen in `docs/spec.md` § 12.3.
 *
 * Each tool is a thin wrapper over `@otelux/engine` so the LM Tools in
 * `apps/vscode-extension` and these MCP tools return identical results.
 *
 * Two tools (`otel_correlate_agent_run`, `otel_get_service_overview`)
 * have stub implementations in M1 — the engine surface they need lands
 * later (agent-run detection in Phase 1 Track B, services overview in
 * Phase 6). `otel_search_logs` is live as of Phase 2. The input schemas
 * are frozen here so clients can integrate today and pick up real data
 * when the engine catches up.
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
