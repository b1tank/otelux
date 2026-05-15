/**
 * `ToggleChip` — pressable filter chip with `aria-pressed`. Used for
 * the "Errors only" filter in the FilterBar.
 *
 * Controlled component. Pass `pressed` and `onPressedChange`. Visual
 * emphasis change is CSS-driven from `aria-pressed="true"`, so themes
 * can restyle without prop changes.
 */

import { type ButtonHTMLAttributes, type JSX, type ReactNode, forwardRef } from 'react';

export interface ToggleChipProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'onChange'> {
	pressed: boolean;
	onPressedChange: (next: boolean) => void;
	icon?: ReactNode;
	children: ReactNode;
	/** Tone applied when pressed. `error` is red-tinted (the "Errors only" use). */
	pressedTone?: 'accent' | 'error';
}

export const ToggleChip = forwardRef<HTMLButtonElement, ToggleChipProps>(
	function ToggleChip(props, ref): JSX.Element {
		const {
			pressed,
			onPressedChange,
			icon,
			children,
			pressedTone = 'accent',
			className,
			onClick,
			type,
			...rest
		} = props;
		const cls = `otelux-toggle-chip otelux-toggle-chip--${pressedTone}${className ? ` ${className}` : ''}`;
		return (
			<button
				ref={ref}
				type={type ?? 'button'}
				className={cls}
				aria-pressed={pressed}
				onClick={(e) => {
					onClick?.(e);
					if (!e.defaultPrevented) {
						onPressedChange(!pressed);
					}
				}}
				{...rest}
			>
				{icon}
				<span>{children}</span>
			</button>
		);
	},
);
