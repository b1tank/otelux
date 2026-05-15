/**
 * `Dropdown` — custom (non-native) single-select listbox.
 *
 * Why not `<select>`: native chrome leaks bright OS colors on the dark
 * theme — broken contrast against the workbench. This is the same
 * reason every modern observability UI ships its own (Jaeger, SigNoz).
 *
 * Pattern: `aria-haspopup="listbox"` button trigger + `role="listbox"`
 * panel, `aria-activedescendant` for keyboard navigation. Each option
 * has a stable id derived from the dropdown's content id.
 *
 * Data-driven options (vs JSX children) so the FilterBar can map raw
 * aggregate data into the menu without an intermediate component
 * layer. Separators are first-class.
 */

import { type JSX, type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import { useDisclosure } from '../hooks/useDisclosure.js';
import { ChevronDownIcon } from './icons.js';

export type DropdownOption =
	| {
			kind?: 'option';
			value: string;
			label: string;
			/** Optional small badge on the right (count, etc). */
			count?: number;
			/** 1-8: pick a service-palette colored dot. */
			colorIndex?: number;
			disabled?: boolean;
	  }
	| { kind: 'separator' };

export interface DropdownProps {
	value: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<DropdownOption>;
	/** Visible label inside the trigger when nothing matches `value`. */
	placeholder?: string;
	/** Override the trigger label; defaults to the matching option's label. */
	triggerLabel?: string;
	/** Optional icon inside the trigger (left of the label). */
	triggerIcon?: ReactNode;
	/** Tooltip + accessible name for the trigger when no visible label is meaningful. */
	'aria-label'?: string;
	className?: string;
}

interface OptionEntry {
	value: string;
	label: string;
	count?: number;
	colorIndex?: number;
	disabled?: boolean;
}

function isOption(o: DropdownOption): o is Extract<DropdownOption, { value: string }> {
	return o.kind !== 'separator';
}

export function Dropdown(props: DropdownProps): JSX.Element {
	const {
		value,
		onChange,
		options,
		placeholder = 'Select…',
		triggerLabel,
		triggerIcon,
		className,
		'aria-label': ariaLabel,
	} = props;

	const disclosure = useDisclosure<HTMLButtonElement, HTMLDivElement>();
	const { open, onToggle, onClose, contentId, triggerProps, contentProps } = disclosure;

	// Flat list of selectable options for keyboard navigation. Indexes
	// here are stable across renders if the option array is stable.
	const selectable: OptionEntry[] = options.filter(isOption).filter((o) => !o.disabled);
	const valueIndex = selectable.findIndex((o) => o.value === value);

	const [highlight, setHighlight] = useState<number>(valueIndex >= 0 ? valueIndex : 0);

	// When opening, jump highlight to the current selection so the user
	// sees where they are. When closing, leave highlight alone — next
	// open re-syncs from `value`.
	useEffect(() => {
		if (open) {
			setHighlight(valueIndex >= 0 ? valueIndex : 0);
		}
	}, [open, valueIndex]);

	const matched = options.find((o) => isOption(o) && o.value === value);
	const visibleLabel = triggerLabel ?? (matched && isOption(matched) ? matched.label : placeholder);

	const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (!open) {
				disclosure.onOpen();
			}
		}
	};

	const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
		if (selectable.length === 0) {
			return;
		}
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				setHighlight((h) => (h + 1) % selectable.length);
				return;
			case 'ArrowUp':
				e.preventDefault();
				setHighlight((h) => (h - 1 + selectable.length) % selectable.length);
				return;
			case 'Home':
				e.preventDefault();
				setHighlight(0);
				return;
			case 'End':
				e.preventDefault();
				setHighlight(selectable.length - 1);
				return;
			case 'Enter':
			case ' ': {
				e.preventDefault();
				const sel = selectable[highlight];
				if (sel) {
					onChange(sel.value);
					onClose();
					triggerProps.ref.current?.focus();
				}
				return;
			}
			case 'Tab':
				onClose();
				return;
		}
	};

	// Focus the listbox when it opens so arrow keys steer it.
	useEffect(() => {
		if (open) {
			contentProps.ref.current?.focus();
		}
	}, [open, contentProps.ref]);

	const optionId = (i: number): string => `${contentId}-opt-${i}`;
	const activeId = open && selectable[highlight] ? optionId(highlight) : undefined;

	return (
		<div className={`otelux-dropdown${className ? ` ${className}` : ''}`}>
			<button
				type="button"
				className="otelux-dropdown__trigger"
				aria-haspopup="listbox"
				aria-label={ariaLabel ?? visibleLabel}
				onClick={onToggle}
				onKeyDown={onTriggerKeyDown}
				{...triggerProps}
			>
				{triggerIcon && <span className="otelux-dropdown__trigger-icon">{triggerIcon}</span>}
				<span className="otelux-dropdown__trigger-label">{visibleLabel}</span>
				<ChevronDownIcon size={14} />
			</button>
			{open && (
				<div className="otelux-dropdown__menu-wrap">
					<div
						{...contentProps}
						// biome-ignore lint/a11y/useSemanticElements: WAI-ARIA listbox pattern; native <select> is rejected by design (OS chrome breaks the theme).
						role="listbox"
						className="otelux-dropdown__menu"
						tabIndex={-1}
						aria-activedescendant={activeId}
						onKeyDown={onListKeyDown}
					>
						{options.map((opt, i) => {
							if (opt.kind === 'separator') {
								return (
									// biome-ignore lint/suspicious/noArrayIndexKey: separators are position-stable in the source options array.
									<hr key={`sep-${i}`} className="otelux-dropdown__separator" />
								);
							}
							const idx = selectable.indexOf(opt);
							const isHighlighted = idx === highlight;
							const isSelected = opt.value === value;
							return (
								// biome-ignore lint/a11y/useFocusableInteractive: aria-activedescendant pattern; only the listbox is a tab stop.
								<div
									key={opt.value}
									id={optionId(idx)}
									// biome-ignore lint/a11y/useSemanticElements: WAI-ARIA listbox option (see container above).
									role="option"
									aria-selected={isSelected}
									className={`otelux-dropdown__option${isHighlighted ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}${opt.disabled ? ' is-disabled' : ''}`}
									onMouseDown={(e) => {
										// mousedown not click: useDisclosure listens to mousedown
										// for outside-detection; selecting via click would close
										// the menu before our handler runs.
										e.preventDefault();
										if (opt.disabled) {
											return;
										}
										onChange(opt.value);
										onClose();
										triggerProps.ref.current?.focus();
									}}
									onMouseEnter={() => {
										if (!opt.disabled) {
											setHighlight(idx);
										}
									}}
								>
									{opt.colorIndex !== undefined && (
										<span
											className="otelux-dropdown__color-dot"
											style={{ background: `var(--otelux-svc-${opt.colorIndex})` }}
										/>
									)}
									<span className="otelux-dropdown__option-label">{opt.label}</span>
									{opt.count !== undefined && (
										<span className="otelux-dropdown__option-count">{opt.count}</span>
									)}
								</div>
							);
						})}
						{selectable.length === 0 && <div className="otelux-dropdown__empty">No options</div>}
					</div>
				</div>
			)}
		</div>
	);
}
