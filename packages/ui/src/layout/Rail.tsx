import { type JSX, type ReactNode, forwardRef } from 'react';

/**
 * One item in the {@link Rail}.
 *
 * The icon is provided as a {@link ReactNode} so callers can compose
 * any icon component (typically the inline SVG icons from
 * `src/primitives/icons`).
 */
export interface RailItem {
	id: string;
	label: string;
	icon: ReactNode;
	disabled?: boolean;
}

export interface RailProps {
	items: ReadonlyArray<RailItem>;
	/** id of the currently active item, or `undefined` when none. */
	activeId?: string;
	onActivate(id: string): void;
	/** Items rendered at the bottom of the rail (e.g. settings). */
	footerItems?: ReadonlyArray<RailItem>;
}

/**
 * Vertical rail used inside `AppShell`'s rail slot.
 *
 * Each item is a square button with the icon centered and the label
 * exposed via `aria-label` + native `title` (no visible text label,
 * by design — the rail is a 56px-wide icon bar). A separator pushes
 * the optional footer items to the bottom.
 */
export const Rail = forwardRef<HTMLDivElement, RailProps>(function Rail(
	props: RailProps,
	ref,
): JSX.Element {
	return (
		<div ref={ref} className="otelux-rail" role="tablist" aria-orientation="vertical">
			<div className="otelux-rail__group">
				{props.items.map((item) => (
					<RailButton
						key={item.id}
						item={item}
						active={item.id === props.activeId}
						onActivate={props.onActivate}
					/>
				))}
			</div>
			{props.footerItems && props.footerItems.length > 0 && (
				<div className="otelux-rail__group otelux-rail__group--footer">
					{props.footerItems.map((item) => (
						<RailButton
							key={item.id}
							item={item}
							active={item.id === props.activeId}
							onActivate={props.onActivate}
						/>
					))}
				</div>
			)}
		</div>
	);
});

interface RailButtonProps {
	item: RailItem;
	active: boolean;
	onActivate(id: string): void;
}

function RailButton(props: RailButtonProps): JSX.Element {
	const { item, active, onActivate } = props;
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			aria-label={item.label}
			title={item.label}
			disabled={item.disabled}
			className={`otelux-rail__button${active ? ' is-active' : ''}`}
			onClick={() => onActivate(item.id)}
		>
			<span className="otelux-rail__icon" aria-hidden>
				{item.icon}
			</span>
		</button>
	);
}
