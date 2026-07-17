/**
 * Icons — monoline inline SVG, 24x24 viewBox, stroke-width 1.8.
 *
 * Why inline (not a library): the design invariant says monoline,
 * consistent stroke, and CSS-driven color via `currentColor`. Importing
 * lucide-react in the desktop bundle costs ~30 KB for ~12 icons; hand-
 * rolled keeps the bundle small and the stroke style identical across
 * the surface.
 *
 * Add an icon by following the existing shape: take the SVG from
 * lucide.dev, swap `stroke` for `currentColor`, keep `stroke-width=1.8`,
 * round line caps + joins.
 */

import type { JSX, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & {
	/** Pixel size; sets both width and height. Defaults to 16. */
	size?: number;
};

function Icon(props: IconProps & { children: JSX.Element | JSX.Element[] }): JSX.Element {
	const { size = 16, children, ...rest } = props;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			{children}
		</svg>
	);
}

export function ChevronDownIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="m6 9 6 6 6-6" />
		</Icon>
	);
}

export function ChevronRightIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="m9 6 6 6-6 6" />
		</Icon>
	);
}

/**
 * Expand-all glyph: two chevrons pointing outward. Lucide name:
 * "chevrons-up-down".
 */
export function ChevronsUpDownIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="m7 15 5 5 5-5" />
			<path d="m7 9 5-5 5 5" />
		</Icon>
	);
}

/**
 * Collapse-all glyph: two chevrons pointing inward. Lucide name:
 * "chevrons-down-up".
 */
export function ChevronsDownUpIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="m7 20 5-5 5 5" />
			<path d="m7 4 5 5 5-5" />
		</Icon>
	);
}

export function CopyIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</Icon>
	);
}

export function DownloadIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" x2="12" y1="15" y2="3" />
		</Icon>
	);
}

export function EyeIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
			<circle cx="12" cy="12" r="3" />
		</Icon>
	);
}

export function ListIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<line x1="8" x2="21" y1="6" y2="6" />
			<line x1="8" x2="21" y1="12" y2="12" />
			<line x1="8" x2="21" y1="18" y2="18" />
			<line x1="3" x2="3.01" y1="6" y2="6" />
			<line x1="3" x2="3.01" y1="12" y2="12" />
			<line x1="3" x2="3.01" y1="18" y2="18" />
		</Icon>
	);
}

export function MonitorIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect width="18" height="12" x="3" y="4" rx="2" />
			<path d="M8 20h8" />
			<path d="M12 16v4" />
		</Icon>
	);
}

export function MoonIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M12 3a6.5 6.5 0 0 0 8.7 8.7A8 8 0 1 1 12 3Z" />
		</Icon>
	);
}

export function PanelLeftIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18" />
		</Icon>
	);
}

export function PanelRightIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M15 3v18" />
		</Icon>
	);
}

export function SearchIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</Icon>
	);
}

export function SunIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2" />
			<path d="M12 20v2" />
			<path d="m4.93 4.93 1.41 1.41" />
			<path d="m17.66 17.66 1.41 1.41" />
			<path d="M2 12h2" />
			<path d="M20 12h2" />
			<path d="m6.34 17.66-1.41 1.41" />
			<path d="m19.07 4.93-1.41 1.41" />
		</Icon>
	);
}

export function SettingsIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</Icon>
	);
}

export function XIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</Icon>
	);
}

export function CheckIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M20 6 9 17l-5-5" />
		</Icon>
	);
}

export function GithubIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
			<path d="M9 18c-4.51 2-5-2-7-2" />
		</Icon>
	);
}

export function AlertCircleIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="10" />
			<line x1="12" x2="12" y1="8" y2="12" />
			<line x1="12" x2="12.01" y1="16" y2="16" />
		</Icon>
	);
}

export function ActivityIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
		</Icon>
	);
}

export function DatabaseIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<ellipse cx="12" cy="5" rx="8" ry="3" />
			<path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
			<path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
		</Icon>
	);
}

export function PlayIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<polygon points="6 3 20 12 6 21 6 3" />
		</Icon>
	);
}

export function PauseIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect x="6" y="4" width="4" height="16" rx="1" />
			<rect x="14" y="4" width="4" height="16" rx="1" />
		</Icon>
	);
}

export function TrashIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
			<line x1="10" x2="10" y1="11" y2="17" />
			<line x1="14" x2="14" y1="11" y2="17" />
		</Icon>
	);
}

export function BarChart3Icon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M3 20V10" />
			<path d="M9 20V4" />
			<path d="M15 20V14" />
			<path d="M21 20V8" />
		</Icon>
	);
}

export function LogsIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<path d="M5 4h14" />
			<path d="M5 9h14" />
			<path d="M5 14h10" />
			<path d="M5 19h8" />
		</Icon>
	);
}

export function WaterfallIcon(props: IconProps): JSX.Element {
	return (
		<Icon {...props}>
			<rect x="3" y="5" width="10" height="3" rx="1" />
			<rect x="6" y="11" width="10" height="3" rx="1" />
			<rect x="9" y="17" width="10" height="3" rx="1" />
		</Icon>
	);
}
