import { type JSX, type ReactNode, forwardRef } from 'react';

/**
 * One item in the {@link Rail}.
 *
 * The icon is provided as a {@link ReactNode} so callers can compose
 * any icon component (typically the inline SVG icons from
 * `src/primitives/icons`).
 *
 * Items with `href` render as anchors (used for external links such
 * as the GitHub repo). Items without `href` render as buttons and
 * invoke {@link RailProps.onActivate} when clicked.
 */
export interface RailItem {
	id: string;
	label: string;
	icon: ReactNode;
	disabled?: boolean;
	/** External link; opens in a new tab with `rel=noopener`. */
	href?: string;
}

export interface RailProps {
	items: ReadonlyArray<RailItem>;
	/** id of the currently active item, or `undefined` when none. */
	activeId?: string;
	onActivate(id: string): void;
	/** Items rendered at the bottom of the rail (e.g. settings). */
	footerItems?: ReadonlyArray<RailItem>;
	/**
	 * Optional brand glyph rendered in a 44px block at the very top of
	 * the rail (above the items). Typically a single character or tiny
	 * inline SVG. The mockup uses an electrical-ground glyph (⏚) in
	 * the accent-2 color.
	 */
	brand?: ReactNode;
	/** Tooltip shown on the brand block. */
	brandLabel?: string;
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
			{props.brand !== undefined && (
				<div className="otelux-rail__brand" title={props.brandLabel} aria-hidden="true">
					{props.brand}
				</div>
			)}
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
	const className = `otelux-rail__button${active ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`;
	const icon = (
		<span className="otelux-rail__icon" aria-hidden>
			{item.icon}
		</span>
	);

	// External links — render as <a> with target/rel. The disabled flag
	// is honored by suppressing the navigation (no href) so screen
	// readers still announce the item but the link is inert.
	if (item.href !== undefined) {
		return (
			<a
				className={className}
				aria-label={item.label}
				title={item.label}
				{...(item.disabled
					? { 'aria-disabled': true }
					: { href: item.href, target: '_blank', rel: 'noopener noreferrer' })}
			>
				{icon}
			</a>
		);
	}

	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			aria-label={item.label}
			title={item.label}
			disabled={item.disabled}
			className={className}
			onClick={() => onActivate(item.id)}
		>
			{icon}
		</button>
	);
}
