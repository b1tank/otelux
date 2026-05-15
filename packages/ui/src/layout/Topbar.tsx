import type { JSX, ReactNode } from 'react';

/**
 * Top horizontal bar (48px) sitting above the workbench.
 *
 * Three slots: {@link start} (brand / breadcrumb), {@link center}
 * (search or title) and {@link end} (action buttons). Any slot may be
 * omitted; the bar still keeps its fixed height so the workbench
 * below never reflows when slot contents change.
 */
export interface TopbarProps {
	start?: ReactNode;
	center?: ReactNode;
	end?: ReactNode;
}

export function Topbar(props: TopbarProps): JSX.Element {
	return (
		<header className="otelux-topbar">
			<div className="otelux-topbar__slot otelux-topbar__slot--start">{props.start}</div>
			<div className="otelux-topbar__slot otelux-topbar__slot--center">{props.center}</div>
			<div className="otelux-topbar__slot otelux-topbar__slot--end">{props.end}</div>
		</header>
	);
}
