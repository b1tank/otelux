import type { JSX } from 'react';
import { PauseIcon, PlayIcon } from './icons.js';

export interface LivePauseToggleProps {
	/** True when live updates are frozen. */
	readonly paused: boolean;
	/** Toggle between live and paused. */
	readonly onToggle: () => void;
}

/**
 * Live-tail control. When live, a pulsing dot signals the view follows new
 * telemetry; clicking freezes it. When paused, the view holds its current
 * result set until resumed. Ingest is unaffected either way — only the view
 * stops following the stream.
 */
export function LivePauseToggle(props: LivePauseToggleProps): JSX.Element {
	const { paused, onToggle } = props;
	return (
		<button
			type="button"
			className={`otelux-live-toggle${paused ? ' otelux-live-toggle--paused' : ''}`}
			onClick={onToggle}
			aria-pressed={paused}
			title={paused ? 'Resume live updates' : 'Pause live updates'}
		>
			{paused ? <PlayIcon size={12} /> : <span className="otelux-live-toggle__dot" aria-hidden />}
			<span>{paused ? 'Paused' : 'Live'}</span>
			{paused ? null : <PauseIcon size={12} className="otelux-live-toggle__hint" />}
		</button>
	);
}
