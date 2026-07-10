/**
 * An extremely thin, reactive router built on the Navigation API
 * (`window.navigation`). It is currently scoped to query-param (URL search
 * param) navigations on the CURRENT path: read the params as an immutable
 * snapshot, patch-merge updates into them, and notify subscribers when they
 * change (including on back/forward traversal).
 *
 *   - No path routing, no route matching, no path params — query params only,
 *     for now.
 *   - Framework-agnostic: this module imports nothing from React. Consumers
 *     never import this core directly — the React bindings in `./react` are
 *     the public surface, re-exported through `@/router`.
 *
 * Writes go through `navigation.navigate(url, { history })`, which is a real
 * (cross-document) navigation unless intercepted. A single `navigate` listener
 * intercepts same-origin, same-pathname navigations to keep them same-document;
 * a single `currententrychange` listener drives reactivity for both our own
 * writes and user-driven history traversal.
 *
 * The listeners are installed EAGERLY at module init behind the `window.navigation`
 * guard (chosen over lazy install-on-first-use: eager keeps the interceptor in
 * place for any navigation from module load onward, and there is nothing to tear
 * down for the lifetime of the single-page example).
 *
 * No fallback: this is a Baseline-2025 API and the example runs in Chromium.
 * Where `window.navigation` is absent, reads still work off `location`, `subscribe`
 * is a no-op, and `navigateSearch` warns once and returns.
 */

/** Snapshot of the current search params as a plain immutable record. */
export type Search = Readonly<Record<string, string>>;

/** A patch merged into the current search: string sets, null/undefined deletes the key. */
export type SearchPatch = Readonly<Record<string, string | null | undefined>>;
export type SearchUpdater = SearchPatch | ((prev: Search) => SearchPatch);

export interface NavigateSearchOptions {
  /** 'push' (default) adds a history entry; 'replace' rewrites the current one. */
  history?: 'push' | 'replace';
}

// --- Minimal Navigation API surface -----------------------------------------
// The DOM lib in this repo's TS version may not ship Navigation API types, so we
// declare only the members used here and keep them private to the example. No
// global augmentation (avoids clashing with a future lib.dom `navigation`); the
// object is reached through a single typed accessor instead.

interface NavigateEventLike extends Event {
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly destination: { readonly url: string };
  readonly intercept: (options?: { handler?: () => void }) => void;
}

interface NavigationLike {
  readonly navigate: (
    url: string,
    options?: { history?: 'auto' | 'push' | 'replace' },
  ) => unknown;
  // A single overload with a union event type: the 'currententrychange' handler
  // ignores its argument (a plain Event at runtime), and a zero-arg listener is
  // assignable to this, so both listeners register without a second signature.
  readonly addEventListener: (
    type: 'navigate' | 'currententrychange',
    listener: (event: NavigateEventLike) => void,
  ) => void;
}

/** The `window.navigation` object when present, else undefined (SSR / unsupported). */
function getNavigation(): NavigationLike | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

// --- Snapshot cache ---------------------------------------------------------
// `getSearch()` must be referentially stable between changes (required for
// `useSyncExternalStore`), so the parsed record is cached and only rebuilt when
// the raw `location.search` string differs from the string it was built from.

const EMPTY_SEARCH: Search = Object.freeze({});

let cachedSearchString: string | null = null;
let cachedSearch: Search = EMPTY_SEARCH;

function parseSearch(search: string): Search {
  const params = new URLSearchParams(search);
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    record[key] = value;
  }
  return Object.freeze(record);
}

export function getSearch(): Search {
  if (typeof window === 'undefined') {
    return EMPTY_SEARCH;
  }
  const current = window.location.search;
  if (current !== cachedSearchString) {
    cachedSearchString = current;
    cachedSearch = parseSearch(current);
  }
  return cachedSearch;
}

// --- Subscriptions ----------------------------------------------------------

const listeners = new Set<() => void>();

/**
 * The `currententrychange` handler. It fires for every current-entry change,
 * including hash-only and (in principle) same-string ones, so it invalidates +
 * notifies ONLY when the raw `location.search` actually differs from the cached
 * snapshot's source string. This one listener covers both our own writes and
 * user-driven back/forward traversal.
 */
function handleCurrentEntryChange(): void {
  if (window.location.search === cachedSearchString) {
    return;
  }
  // Invalidate: the next `getSearch()` rebuilds a fresh frozen snapshot.
  cachedSearchString = null;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * The `navigate` handler. `navigation.navigate()` is a real navigation unless
 * intercepted, so convert same-origin, same-pathname navigations into
 * same-document ones. Everything else (cross-origin, path change, hash-only,
 * downloads, or when interception is unavailable) is left to proceed normally.
 */
function handleNavigate(event: NavigateEventLike): void {
  if (!event.canIntercept) {
    return;
  }
  if (event.hashChange) {
    return;
  }
  if (event.downloadRequest !== null) {
    return;
  }
  const destination = new URL(event.destination.url);
  const current = new URL(window.location.href);
  if (destination.origin !== current.origin) {
    return;
  }
  if (destination.pathname !== current.pathname) {
    return;
  }
  // An empty intercept (no handler) is enough to keep this same-document.
  event.intercept();
}

// Eager, guarded listener install (see the module docstring for the rationale).
const navigation = getNavigation();
if (navigation !== undefined) {
  navigation.addEventListener('navigate', handleNavigate);
  navigation.addEventListener('currententrychange', handleCurrentEntryChange);
}

export function subscribe(listener: () => void): () => void {
  if (navigation === undefined) {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Writes -----------------------------------------------------------------

let warnedUnsupported = false;

export function navigateSearch(
  updater: SearchUpdater,
  options?: NavigateSearchOptions,
): void {
  if (navigation === undefined) {
    if (!warnedUnsupported) {
      warnedUnsupported = true;
      console.warn(
        'router: window.navigation is unavailable; navigateSearch is a no-op.',
      );
    }
    return;
  }

  const patch = typeof updater === 'function' ? updater(getSearch()) : updater;

  // Build the next params from the current ones plus the patch: a string value
  // sets the key, a null/undefined value deletes it.
  const currentParams = new URLSearchParams(window.location.search);
  const nextParams = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
  }

  // No-op guard: comparing the re-serialized strings (both derived from the same
  // source) avoids stacking duplicate history entries under the push default.
  const nextString = nextParams.toString();
  if (nextString === currentParams.toString()) {
    return;
  }

  const url = new URL(window.location.href);
  url.search = nextString;
  navigation.navigate(url.href, { history: options?.history ?? 'push' });
}
