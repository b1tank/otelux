import { CheckIcon, CopyIcon } from '@otelux/ui';
import { type JSX, useEffect, useRef, useState } from 'react';
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
				<CopyableUrl url={url} />
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

function CopyableUrl({ url }: { url: string }): JSX.Element {
	const [justCopied, setJustCopied] = useState(false);
	// Track the timer so we can clear it on unmount or rapid re-clicks
	// (previously the timer leaked into a stale closure on unmount).
	const timerRef = useRef<number | null>(null);
	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}
		};
	}, []);
	const onClick = (): void => {
		void navigator.clipboard.writeText(url).then(() => {
			setJustCopied(true);
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}
			timerRef.current = window.setTimeout(() => setJustCopied(false), 1200);
		});
	};
	return (
		<button
			type="button"
			className="endpoint-bar__url endpoint-bar__url--copy"
			onClick={onClick}
			// Tooltip carries the affordance hint so the in-button label
			// can be an icon-only state cue (no width swap → no flicker
			// when the URL re-renders next to a longer/shorter label).
			title={justCopied ? 'Copied' : 'Click to copy'}
			aria-label={justCopied ? 'Copied' : 'Copy URL'}
		>
			<code>{url}</code>
			<span className="endpoint-bar__copy-icon" aria-hidden="true">
				{justCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
			</span>
		</button>
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
