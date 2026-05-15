/**
 * Barrel for `@otelux/ui/src/primitives`. Components here are
 * presentation-only and free of `@otelux/protocol` / `@otelux/types`
 * imports — they can be used in any host without a data source.
 */

export { Dropdown } from './Dropdown.js';
export type { DropdownOption, DropdownProps } from './Dropdown.js';
export { IconButton } from './IconButton.js';
export type { IconButtonProps } from './IconButton.js';
export { ToggleChip } from './ToggleChip.js';
export type { ToggleChipProps } from './ToggleChip.js';
export {
	ActivityIcon,
	AlertCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	EyeIcon,
	GithubIcon,
	ListIcon,
	PanelLeftIcon,
	PanelRightIcon,
	SearchIcon,
	SettingsIcon,
	XIcon,
} from './icons.js';
export type { IconProps } from './icons.js';
