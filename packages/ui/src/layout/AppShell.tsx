import type { JSX, ReactNode } from 'react';

/**
 * Top-level shell for the OTelux workbench.
 *
 * A two-column layout: a fixed-width vertical {@link rail} on the left
 * and a flexible main column on the right. The shell itself fills its
 * parent (typically `<body>`) and never scrolls — only nested children
 * are allowed to scroll.
 *
 * Slots are intentionally rendered as plain children rather than via
 * named props so the shell stays oblivious to the concrete components;
 * the layout works equally well in tests with placeholder nodes.
 */
export interface AppShellProps {
	/** Vertical rail rendered on the left edge. */
	rail: ReactNode;
	/** Main column content. The caller is responsible for stacking
	 *  topbar / filters / workbench / status as desired. */
	children: ReactNode;
}

export function AppShell(props: AppShellProps): JSX.Element {
	return (
		<div className="otelux-app-shell">
			<aside className="otelux-app-shell__rail">{props.rail}</aside>
			<main className="otelux-app-shell__main">{props.children}</main>
		</div>
	);
}
