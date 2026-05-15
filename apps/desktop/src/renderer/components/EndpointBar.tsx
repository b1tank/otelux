import { CopyButton } from '@otelux/ui';
import type { JSX } from 'react';
import type { ReceiverStatus } from '../../shared/ipc.js';

interface EndpointBarProps {
	readonly status: ReceiverStatus | undefined;
}

/**
 * Top strip showing where the OTLP/HTTP receiver is listening. Click the
 * URL to copy. The status dot is green when the receiver is bound, amber
 * while it's restarting, and red on bind error — so the user gets a
 * single-glance answer to "is OTelux ready to receive traces?".
 *
 * The settings entry point lives on the rail (bottom of the left nav),
 * not here, so this bar stays focused on receiver state.
 */
export function EndpointBar(props: EndpointBarProps): JSX.Element {
	const { status } = props;
	const url = endpointUrl(status);

	return (
		<div className="endpoint-bar">
			<StatusDot status={status} />
			<span className="endpoint-bar__label">OTLP/HTTP</span>
			{url ? (
				// Shared CopyButton primitive: morphs Copy→Check (green)
				// on success and never reflows the row width.
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
		</div>
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

function endpointUrl(status: ReceiverStatus | undefined): string | undefined {
	if (!status || status.kind !== 'running') {
		return undefined;
	}
	return `http://${status.host}:${status.port}/v1/traces`;
}

function statusText(status: ReceiverStatus | undefined): string {
	if (!status) {
		return 'connecting…';
	}
	switch (status.kind) {
		case 'starting':
			return 'starting…';
		case 'running':
			return `listening on http://${status.host}:${status.port}/v1/traces`;
		case 'error':
			return `failed to bind ${status.host}:${status.port}: ${status.message}`;
	}
}
