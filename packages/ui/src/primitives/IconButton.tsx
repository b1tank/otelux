/**
 * `IconButton` — square 28x28 button hosting an icon. Used for restore
 * buttons in pane headers, copy / download in the value viewer, the X
 * on the drawer, and any other icon-only action.
 *
 * Why a primitive: every icon-only control needs (1) a real `<button>`
 * with a non-default focus state, (2) an `aria-label` since there's no
 * visible text, and (3) a tooltip-like `title`. Centralizing here keeps
 * those three from drifting per call-site.
 */

import { type ButtonHTMLAttributes, type JSX, forwardRef } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Required: screen-reader name for the action. */
	'aria-label': string;
	/** Native tooltip. Defaults to the aria-label so they never drift. */
	title?: string;
	/** Visual emphasis. */
	variant?: 'ghost' | 'subtle';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	function IconButton(props, ref): JSX.Element {
		const { variant = 'ghost', title, className, type, children, ...rest } = props;
		const cls = `otelux-icon-button otelux-icon-button--${variant}${className ? ` ${className}` : ''}`;
		return (
			<button
				ref={ref}
				type={type ?? 'button'}
				title={title ?? props['aria-label']}
				className={cls}
				{...rest}
			>
				{children}
			</button>
		);
	},
);
