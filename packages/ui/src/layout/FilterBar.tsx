import type { JSX, ReactNode } from 'react';

/**
 * Horizontal filter row (44px) sitting between the topbar and the
 * workbench panes.
 *
 * Two slots: {@link filters} on the left for the primary filter
 * controls (typically `Dropdown`s and `ToggleChip`s) and {@link end}
 * on the right for secondary controls (clear, save view, etc.).
 *
 * The bar scrolls horizontally when filters overflow rather than
 * wrapping to a second row, because wrapping would change the
 * workbench's vertical offset and trigger a layout shift on every
 * filter change.
 */
export interface FilterBarProps {
	filters: ReactNode;
	end?: ReactNode;
}

export function FilterBar(props: FilterBarProps): JSX.Element {
	return (
		<div className="otelux-filter-bar">
			<div className="otelux-filter-bar__filters">{props.filters}</div>
			{props.end !== undefined && <div className="otelux-filter-bar__end">{props.end}</div>}
		</div>
	);
}
