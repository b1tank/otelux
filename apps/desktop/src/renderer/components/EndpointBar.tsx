import { CopyButton } from '@otelux/ui';
import type { JSX } from 'react';
import type { McpStatus, ReceiverStatus } from '../../shared/ipc.js';

interface EndpointBarProps {
	readonly status: ReceiverStatus | undefined;
	readonly mcpStatus: McpStatus | undefined;
}

/**
 * Top strip showing where the OTLP/HTTP receiver is listening, plus —
 * when enabled — a compact MCP pill that surfaces the MCP server's
 * endpoint to the right of the OTLP URL. Click either URL to copy.
 *
 * The status dot is green when the receiver is bound, amber while it's
 * restarting, and red on bind error. The MCP pill is hidden entirely
 * when MCP is disabled so the bar stays compact for users who never
 * touch agentic flows.
 *
 * The settings entry point lives on the rail (bottom of the left nav),
 * not here, so this bar stays focused on receiver/MCP state.
 */
export function EndpointBar(props: EndpointBarProps): JSX.Element {
	const { status, mcpStatus } = props;
	const url = receiverBaseUrl(status);

	return (
		<div className="endpoint-bar">
			<StatusDot status={status} />
			<span className="endpoint-bar__label">OTLP/HTTP</span>
			{url ? (
				<CopyButton
					value={url}
					title="Click to copy"
					ariaLabel="Copy OTLP/HTTP URL"
					className="endpoint-bar__url endpoint-bar__url--copy"
				>
					<code>{url}</code>
				</CopyButton>
			) : (
				<span className="endpoint-bar__url">{statusText(status)}</span>
			)}
			<McpPill status={mcpStatus} />
			<BetaBadge />
		</div>
	);
}

/**
 * Always-visible beta indicator. The tooltip states the two limitations a
 * user most needs to know up front so they are visible in the app itself,
 * not just in release notes: telemetry is in-memory for the session only,
 * and ingest is OTLP/HTTP JSON.
 */
function BetaBadge(): JSX.Element {
	const tooltip =
		'Beta build. Telemetry is kept in memory for this session only and is not persisted across restarts. Ingest accepts OTLP/HTTP JSON only.';
	return (
		<span className="endpoint-bar__beta" title={tooltip} aria-label={tooltip}>
			Beta
		</span>
	);
}

function StatusDot({ status }: { status: ReceiverStatus | undefined }): JSX.Element {
	const kind = status?.kind ?? 'starting';
	return (
		<span
			className={`endpoint-bar__dot endpoint-bar__dot--${kind}`}
			title={statusText(status)}
			aria-label={statusText(status)}
		/>
	);
}

/**
 * Compact MCP status pill. Three visible states:
 * - running  → green-dotted pill with copy-on-click URL, so the user
 *              can paste it into Codex CLI / Claude Code / Cursor.
 * - error    → red-dotted pill with the OS bind error in the tooltip.
 * - disabled → hidden; nothing renders.
 *
 * `starting` and `undefined` (still hydrating) collapse into a muted
 * dot with no copy affordance — same approach the OTLP side uses.
 */
function McpPill({ status }: { status: McpStatus | undefined }): JSX.Element | null {
	if (!status || status.kind === 'disabled') {
		return null;
	}
	const tooltip = mcpStatusText(status);
	if (status.kind === 'running') {
		const url = `http://${status.host}:${status.port}/`;
		return (
			<CopyButton
				value={url}
				title="Click to copy MCP server URL"
				ariaLabel="Copy MCP server URL"
				className="endpoint-bar__mcp endpoint-bar__mcp--running"
			>
				<span
					className="endpoint-bar__dot endpoint-bar__dot--running endpoint-bar__dot--inline"
					aria-hidden="true"
				/>
				<span>MCP</span>
				<code>{`:${status.port}`}</code>
			</CopyButton>
		);
	}
	return (
		<span
			className={`endpoint-bar__mcp endpoint-bar__mcp--${status.kind}`}
			title={tooltip}
			aria-label={tooltip}
		>
			<span
				className={`endpoint-bar__dot endpoint-bar__dot--${status.kind} endpoint-bar__dot--inline`}
				aria-hidden="true"
			/>
			<span>MCP</span>
		</span>
	);
}

function receiverBaseUrl(status: ReceiverStatus | undefined): string | undefined {
	if (!status || status.kind !== 'running') {
		return undefined;
	}
	return `http://${status.host}:${status.port}`;
}

function statusText(status: ReceiverStatus | undefined): string {
	if (!status) {
		return 'connecting…';
	}
	switch (status.kind) {
		case 'starting':
			return 'starting…';
		case 'running':
			return `listening on http://${status.host}:${status.port}`;
		case 'error':
			return `failed to bind ${status.host}:${status.port}: ${status.message}`;
	}
}

function mcpStatusText(status: McpStatus): string {
	switch (status.kind) {
		case 'starting':
			return 'MCP server starting…';
		case 'running':
			return `MCP server listening on http://${status.host}:${status.port}/`;
		case 'disabled':
			return 'MCP server disabled';
		case 'error':
			return `MCP server failed to bind ${status.host}:${status.port}: ${status.message}`;
	}
}
