/**
 * `Accordion` — a list of independently collapsible sections.
 *
 * Multi-open by default: opening one section does not close the others.
 * Section state can be controlled by the parent (`openIds` + `onOpenChange`)
 * or left uncontrolled (each item's `defaultOpen` seeds the initial set).
 *
 * Each section header is a real `<button>` with `aria-expanded` and
 * `aria-controls`, and the body region carries `aria-labelledby` so the
 * disclosure relationship is exposed to assistive tech.
 *
 * Layered import discipline: lives under `src/primitives/` and has no
 * data-source dependency. Hosts (e.g. SpanDetail) pass arbitrary
 * `ReactNode` bodies.
 */

import { type ReactNode, useCallback, useId, useState } from 'react';
import { ChevronRightIcon } from './icons.js';

export interface AccordionItem {
	/** Stable identity used in the open set. */
	id: string;
	/** Header content; usually a plain string. */
	label: ReactNode;
	/** Body content rendered when this section is open. */
	children: ReactNode;
	/** Optional right-aligned hint such as a count chip. */
	badge?: ReactNode;
	/** Seeds the uncontrolled open set on first render. Ignored when controlled. */
	defaultOpen?: boolean;
}

export interface AccordionProps {
	items: readonly AccordionItem[];
	/** Controlled set of open ids. When supplied, `defaultOpen` is ignored. */
	openIds?: ReadonlySet<string>;
	/** Called with the next open set after the user toggles a section. */
	onOpenChange?: (next: ReadonlySet<string>) => void;
}

export function Accordion(props: AccordionProps): JSX.Element {
	const { items, openIds, onOpenChange } = props;
	const isControlled = openIds !== undefined;

	const [uncontrolled, setUncontrolled] = useState<ReadonlySet<string>>(() => {
		const seed = new Set<string>();
		for (const it of items) {
			if (it.defaultOpen) {
				seed.add(it.id);
			}
		}
		return seed;
	});

	const effective = isControlled ? openIds : uncontrolled;

	const toggle = useCallback(
		(id: string): void => {
			const next = new Set(effective);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			if (!isControlled) {
				setUncontrolled(next);
			}
			onOpenChange?.(next);
		},
		[effective, isControlled, onOpenChange],
	);

	return (
		<div className="otelux-accordion">
			{items.map((it) => (
				<AccordionRow key={it.id} item={it} open={effective.has(it.id)} onToggle={toggle} />
			))}
		</div>
	);
}

interface AccordionRowProps {
	item: AccordionItem;
	open: boolean;
	onToggle: (id: string) => void;
}

function AccordionRow(props: AccordionRowProps): JSX.Element {
	const { item, open, onToggle } = props;
	const headerId = useId();
	const bodyId = useId();
	return (
		<section className={`otelux-accordion__item${open ? ' is-open' : ''}`}>
			<button
				id={headerId}
				type="button"
				className="otelux-accordion__head"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => onToggle(item.id)}
			>
				<ChevronRightIcon
					className={`otelux-accordion__chevron${open ? ' is-open' : ''}`}
					aria-hidden="true"
				/>
				<span className="otelux-accordion__label">{item.label}</span>
				{item.badge !== undefined ? (
					<span className="otelux-accordion__badge">{item.badge}</span>
				) : null}
			</button>
			{open ? (
				<section id={bodyId} aria-labelledby={headerId} className="otelux-accordion__body">
					{item.children}
				</section>
			) : null}
		</section>
	);
}
