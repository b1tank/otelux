/**
 * Barrel for hooks living in `@otelux/ui/src/hooks`. Re-export every
 * hook here so callers say `from './hooks/index.js'` rather than
 * reaching into individual files.
 */

export { clampWidth, useResizable } from './useResizable.js';
export type { UseResizableOptions, UseResizableResult } from './useResizable.js';
