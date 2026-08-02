import type { JSX } from 'react';
import { SearchField } from './SearchField.js';

export interface DetailSearchProps {
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly subject: 'span' | 'log';
}

/** Fixed search affordance shared by span and log detail drawers. */
export function DetailSearch(props: DetailSearchProps): JSX.Element {
	return (
		<search className="otelux-detail-search">
			<SearchField
				value={props.value}
				onChange={props.onChange}
				placeholder="Search details"
				aria-label={`Search ${props.subject} details`}
			/>
		</search>
	);
}

export function DetailSearchEmpty(): JSX.Element {
	return <output className="otelux-detail-search__empty">No matching details.</output>;
}

/** Case-insensitive substring matching across visible detail key/value text. */
export function detailMatches(query: string, ...values: readonly unknown[]): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle === '') {
		return true;
	}
	return values.some((value) =>
		String(value ?? '')
			.toLocaleLowerCase()
			.includes(needle),
	);
}
