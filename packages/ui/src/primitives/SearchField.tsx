/**
 * `SearchField` — magnifier + input + clear button.
 *
 * Controlled component: callers own the string value. The clear
 * button is rendered only when the field is non-empty so it never
 * occupies space in the empty state.
 *
 * Why a primitive and not bare <input>: the filter bar reuses the
 * exact 28px height + accent focus ring of the other primitives, and
 * the magnifier icon is positioned absolutely against the input
 * (which requires its own wrapper). Extracting keeps the layout
 * component free of these affordances.
 */

import { type ChangeEvent, type JSX, useId } from 'react';
import { SearchIcon, XIcon } from './icons.js';

export interface SearchFieldProps {
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	'aria-label'?: string;
	/** Visible label rendered to the left of the input (mute uppercase). */
	label?: string;
}

export function SearchField(props: SearchFieldProps): JSX.Element {
	const { value, onChange, placeholder, label } = props;
	const ariaLabel = props['aria-label'] ?? placeholder ?? 'Search';
	const id = useId();

	return (
		<div className="otelux-search-field">
			{label !== undefined ? (
				<label className="otelux-search-field__label" htmlFor={id}>
					{label}
				</label>
			) : null}
			<span className="otelux-search-field__icon" aria-hidden>
				<SearchIcon size={14} />
			</span>
			<input
				id={id}
				className="otelux-search-field__input"
				type="text"
				value={value}
				onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				spellCheck={false}
				autoComplete="off"
			/>
			{value.length > 0 ? (
				<button
					type="button"
					className="otelux-search-field__clear"
					onClick={() => onChange('')}
					aria-label="Clear search"
					title="Clear search"
				>
					<XIcon size={12} />
				</button>
			) : null}
		</div>
	);
}
