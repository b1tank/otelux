/**
 * `usePaneCollapse` — owns the {listCollapsed, wfCollapsed} state for
 * the two-pane workbench and enforces invariant 1 of the design:
 *
 *   "Never both panes collapsed at once."
 *
 * Centralizing the rule here means components that toggle collapse
 * (the in-header buttons in each pane, the `[` / `]` shortcut handler)
 * can't accidentally break it: the only way to collapse one side is
 * through this hook, and collapsing always uncollapses the other.
 *
 * The collapse state is **transient** by design — it is _not_ persisted
 * across reloads, because the right behavior on cold start is to show
 * both panes. If a future requirement says "remember last collapse",
 * add a `storageKey` option and write on commit (same pattern as
 * `useResizable`).
 */

import { useCallback, useState } from 'react';

export type Pane = 'list' | 'wf';

export interface UsePaneCollapseResult {
	listCollapsed: boolean;
	wfCollapsed: boolean;
	/** Hide the named pane. Forces the other pane visible (invariant 1). */
	collapse: (pane: Pane) => void;
	/** Re-show the named pane. */
	restore: (pane: Pane) => void;
	/** Toggle the named pane. Forces the other visible if this one closes. */
	toggle: (pane: Pane) => void;
}

export interface UsePaneCollapseOptions {
	initialListCollapsed?: boolean;
	initialWfCollapsed?: boolean;
}

export function usePaneCollapse(options: UsePaneCollapseOptions = {}): UsePaneCollapseResult {
	// Honor incoming "both collapsed" as a config error — fall back to
	// "both visible" silently rather than crashing at runtime.
	const bothInitiallyCollapsed = options.initialListCollapsed && options.initialWfCollapsed;
	const [listCollapsed, setListCollapsed] = useState<boolean>(
		bothInitiallyCollapsed ? false : (options.initialListCollapsed ?? false),
	);
	const [wfCollapsed, setWfCollapsed] = useState<boolean>(
		bothInitiallyCollapsed ? false : (options.initialWfCollapsed ?? false),
	);

	const collapse = useCallback((pane: Pane): void => {
		if (pane === 'list') {
			setListCollapsed(true);
			setWfCollapsed(false);
		} else {
			setWfCollapsed(true);
			setListCollapsed(false);
		}
	}, []);

	const restore = useCallback((pane: Pane): void => {
		if (pane === 'list') {
			setListCollapsed(false);
		} else {
			setWfCollapsed(false);
		}
	}, []);

	const toggle = useCallback((pane: Pane): void => {
		if (pane === 'list') {
			setListCollapsed((prev) => {
				if (prev) {
					return false;
				}
				setWfCollapsed(false);
				return true;
			});
		} else {
			setWfCollapsed((prev) => {
				if (prev) {
					return false;
				}
				setListCollapsed(false);
				return true;
			});
		}
	}, []);

	return { listCollapsed, wfCollapsed, collapse, restore, toggle };
}
