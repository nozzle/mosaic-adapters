/**
 * React bindings for the router core in `./core` — the router's public surface
 * (re-exported through `@/router`), so app code never imports the core directly.
 * Each hook is a thin `useSyncExternalStore` wrapper over the framework-agnostic
 * core, so the core owns all reactivity and history semantics; these hooks only
 * bridge it into React's render loop. The router is currently scoped to
 * query-param (URL search param) navigations on the current path.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { getSearch, navigateSearch, subscribe } from './core';
import type { Search } from './core';

// Consumers need the router's types without reaching into the core.
export type {
  NavigateSearchOptions,
  Search,
  SearchPatch,
  SearchUpdater,
} from './core';

/** The whole search record, reactive. Re-renders on any search change. */
export function useSearch(): Search {
  // `getSearch` is referentially stable between changes and returns a frozen
  // empty object server-side, so it doubles as the server snapshot.
  return useSyncExternalStore(subscribe, getSearch, getSearch);
}

/**
 * A single search param, reactive. Reads the primitive `search[key]` through a
 * per-key `getSnapshot`, so `useSyncExternalStore`'s primitive equality naturally
 * limits re-renders to changes of THIS key — unrelated keys changing do not
 * re-render the caller.
 */
export function useSearchParam(key: string): string | undefined {
  const getSnapshot = useCallback(
    (): string | undefined => getSearch()[key],
    [key],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The stable `navigateSearch` setter (module-level identity, never changes). */
export function useNavigateSearch(): typeof navigateSearch {
  return navigateSearch;
}
