/**
 * Barrel for hooks living in `@otelux/ui/src/hooks`. Re-export every
 * hook here so callers say `from './hooks/index.js'` rather than
 * reaching into individual files.
 */

export { clampWidth, useResizable } from './useResizable.js';
export type { UseResizableOptions, UseResizableResult } from './useResizable.js';
export { useDisclosure } from './useDisclosure.js';
export type { UseDisclosureOptions, UseDisclosureResult } from './useDisclosure.js';
export { usePaneCollapse } from './usePaneCollapse.js';
export type { Pane, UsePaneCollapseOptions, UsePaneCollapseResult } from './usePaneCollapse.js';
