import type { JSX } from 'react';

export interface ResultFooterProps {
	/** Number of items currently shown. */
	readonly count: number;
	/** Singular noun for the items (e.g. "trace"); pluralized automatically. */
	readonly noun: string;
	/** True when live updates are frozen. */
	readonly paused: boolean;
}

/**
 * Persistent result footer sitting outside the scroll region. Communicates the
 * result scope ("Showing N traces") and the live/paused state so both are
 * visible without scrolling — the workbench invariant that footers report
 * result count and streaming state.
 */
export function ResultFooter(props: ResultFooterProps): JSX.Element {
	const { count, noun, paused } = props;
	const plural = count === 1 ? noun : `${noun}s`;
	return (
		<div className="otelux-result-footer">
			<span className="otelux-result-footer__count">
				Showing {count} {plural}
			</span>
			<span
				className={`otelux-result-footer__state${paused ? ' otelux-result-footer__state--paused' : ''}`}
			>
				{paused ? 'Paused' : 'Live'}
			</span>
		</div>
	);
}
