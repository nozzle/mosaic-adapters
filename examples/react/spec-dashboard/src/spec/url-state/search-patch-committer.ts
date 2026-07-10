/** Coalesced URL commits for the dashboard's React-owned persistence boundary. */
import type { NavigateSearchOptions, SearchPatch } from '@/router';

export const SELECTION_THROTTLE_MS = 120;
export const FILTER_DEBOUNCE_MS = 300;

export type SearchCommitMode = 'selection' | 'filter';

export interface SearchPatchCommitter {
  schedule: (patch: SearchPatch, mode: SearchCommitMode) => void;
  cancel: () => void;
}

type NavigateSearch = (
  patch: SearchPatch,
  options?: NavigateSearchOptions,
) => void;

/**
 * Create one latest-value queue shared by FilterSet and Selection URL state.
 *
 * Selection changes use a short trailing throttle: continuous brushing commits
 * at most once per window and the final value follows within one window.
 * Filter changes use a trailing debounce, reset by every keystroke. Filter mode
 * takes precedence over an already-pending selection window so both domains are
 * still committed in one merged replace navigation.
 */
export function createSearchPatchCommitter(
  navigateSearch: NavigateSearch,
  delays: { selection?: number; filter?: number } = {},
): SearchPatchCommitter {
  const selectionDelay = delays.selection ?? SELECTION_THROTTLE_MS;
  const filterDelay = delays.filter ?? FILTER_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingMode: SearchCommitMode | null = null;
  let pendingPatch: Record<string, string | null | undefined> = {};

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (): void => {
    timer = null;
    pendingMode = null;
    const patch = pendingPatch;
    pendingPatch = {};
    if (Object.keys(patch).length === 0) {
      return;
    }
    navigateSearch(patch, { history: 'replace' });
  };

  return {
    schedule: (patch, mode) => {
      Object.assign(pendingPatch, patch);

      if (mode === 'filter') {
        clearTimer();
        pendingMode = 'filter';
        timer = setTimeout(flush, filterDelay);
        return;
      }

      // Do not shorten a pending text/filter debounce with a brush update.
      if (pendingMode === 'filter') {
        return;
      }
      if (timer === null) {
        pendingMode = 'selection';
        timer = setTimeout(flush, selectionDelay);
      }
    },
    cancel: () => {
      clearTimer();
      pendingMode = null;
      pendingPatch = {};
    },
  };
}
