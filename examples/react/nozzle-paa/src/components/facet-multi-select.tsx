/**
 * The ONE shared facet multi-select control, used by BOTH the Classic
 * Domain/Device/Keyword-Group controls AND the Builder facet value editors.
 *
 * It is the mechanism that unifies the two authoring views on a single spec:
 *
 * - **Options + counts** come from {@link useMosaicFacet} in read-only mode (no
 *   `publish`), cascaded by the page context (`$page`) — so the list narrows as
 *   other filters change, exactly like the old dropdown, but it never owns the
 *   selection. The search box's displayed value is immediate, but the value
 *   fed into `inputs.search` (and thus the option query) is debounced by
 *   `SEARCH_DEBOUNCE_MS` — every distinct search string is a fresh,
 *   never-cache-hitting `ILIKE` query, so querying on every keystroke would
 *   flood the connector.
 * - **The current selection + trigger label** are DERIVED from the committed
 *   `condition` spec in the {@link filterSet} store (read via
 *   `useFilterSetState`), NOT from the facet client's `selected` (which is empty
 *   while a dropdown-gated client is disabled). This is the fix for the stale
 *   "All" label after a cross-view edit.
 * - **Toggling** writes a `condition` spec (`{ id, column, kind:'condition',
 *   operator, value: string[], label }`) via `filterSet.set`, and
 *   `filterSet.remove(id)` when the selection empties — so Classic and Builder
 *   produce identical, losslessly hydrating state.
 *
 * The `operator` is owned by the caller: array-column facets pass
 * `list_has_any` (etc.), scalar facets pass `in`/`not_in`. Emptiness operators
 * (`is_empty`/`is_not_empty`, arity `none`) carry no value list, so the caller
 * hides this control for them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useFilterSetState, useMosaicFacet } from '@nozzleio/react-mosaic';
import { tableName } from '../page-context';
import { usePageContexts, usePageFilterSet } from '../topology';
import {
  facetTriggerLabel,
  useDebouncedRun,
  useSelectedValues,
} from '../filter-controls';
import type { FilterSpec } from '@nozzleio/react-mosaic';

/**
 * How long a keystroke in the search box waits before it reaches the facet
 * client's `inputs.search` and issues a new `ILIKE` option query. Every
 * distinct search string is a fresh, never-cache-hitting query, so an
 * undebounced control fires one query per keystroke; 400ms collapses a
 * normal typing burst into (typically) one query for the settled string,
 * mirroring embedding-atlas's debounced facet search.
 */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * Multi-value operators whose value list is a set of EXCLUSIONS rather than
 * inclusions. Under these, the option list shows all pickable values and marks
 * none as checked — the excluded values appear as ordinary, still-toggleable
 * options (so e.g. a `not_in [reddit.com]` Domain filter still lists reddit.com,
 * unchecked, in its own self-excluded option list).
 */
const EXCLUSION_OPERATORS = new Set<string>(['not_in', 'excludes_all']);

/**
 * The multi-value `condition` operators the Classic facet control can preserve
 * when toggling a value over a Builder-authored spec. Emptiness operators
 * (`is_empty`/`is_not_empty`, arity `none`) carry no value list, so toggling a
 * value under them makes no sense — the caller falls back to its prop default.
 */
const MULTI_VALUE_OPERATORS = new Set([
  'in',
  'not_in',
  'list_has_any',
  'list_has_all',
  'excludes_all',
]);

/** True when `operator` is a value-bearing multi-value membership operator. */
function isMultiValueOperator(operator: unknown): operator is string {
  return typeof operator === 'string' && MULTI_VALUE_OPERATORS.has(operator);
}

export interface FacetMultiSelectProps {
  /** Canonical spec id shared with the field's other authoring view. */
  specId: string;
  /** Column (or struct path) the facet enumerates and the spec filters. */
  column: string;
  /** DuckDB list/array column → the option query unnests it. */
  arrayColumn?: boolean;
  /** Chip + spec label. */
  label: string;
  /** The `condition` operator the written spec carries (`in`, `list_has_any`, …). */
  operator: string;
  /** Option-query sort. */
  sort: 'count' | 'alpha';
  /** Option-query limit. */
  limit: number;
  /** Gate the read-only option query (page readiness). */
  enabled: boolean;
  /** `data-testid` root; the option buttons get `${testId}-option`. */
  testId: string;
}

export function FacetMultiSelect(props: FacetMultiSelectProps) {
  const { specId, column, label, operator } = props;
  // `search` is the input's displayed value (immediate); `debouncedSearch` is
  // what reaches the facet client's `inputs` (see `SEARCH_DEBOUNCE_MS`).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchDebounce = useDebouncedRun(SEARCH_DEBOUNCE_MS);
  const filterSet = usePageFilterSet();
  const { page } = usePageContexts();

  // Read-only options + cascade counts — NO publish; the spec store owns state.
  const facet = useMosaicFacet({
    from: tableName,
    column,
    arrayColumn: props.arrayColumn,
    select: 'multi',
    sort: props.sort,
    filterBy: page,
    inputs: { search: debouncedSearch, limit: props.limit },
    enabled: props.enabled,
  });

  // Self-exclusion: register THIS option query's client as the spec's clause
  // source, so the facet's own list is cascaded by every OTHER filter but not
  // by its own selection. Without this, picking one domain collapses the list
  // to that domain's co-occurring values — you could never pick a second.
  // (This is exactly what `publish.into` wired automatically before this facet
  // went read-only; we replicate it on the manual `set`.)
  const clients = useMemo(
    () => new Set([facet.client.mosaicClient]),
    [facet.client],
  );

  // The selection is derived from the committed spec, so it is correct even
  // while this facet client is idle (menu closed, page just switched views).
  const selected = useSelectedValues(specId);

  // The committed operator, read back from the store, so Classic edits over a
  // Builder-authored spec preserve the operator the Builder chose (e.g.
  // `not_in`) instead of stamping this control's prop default.
  const { specs } = useFilterSetState(filterSet);
  const committedOperator = specs.find(
    (entry) => entry.id === specId,
  )?.operator;

  // Whether the ACTIVE operator includes (checkmark = "in your selection") or
  // excludes (`not_in`/`excludes_all`) its values. For an exclusion operator the
  // spec's values are the ones filtered OUT, so no option is shown checked: the
  // list is just the pickable domains, and the excluded value (e.g. reddit.com
  // under `not_in`) appears as a normal, unchecked, still-toggleable option.
  const effectiveOperator = committedOperator ?? operator;
  const isExclusionOperator = EXCLUSION_OPERATORS.has(effectiveOperator);

  // Writes the spec under a chosen operator. Callers pick the operator: the
  // toggle preserves a Builder-authored multi-value operator when present,
  // falling back to the prop default otherwise.
  const writeSpec = (value: Array<string>, writeOperator: string) => {
    const spec: FilterSpec = {
      id: specId,
      column,
      kind: 'condition',
      operator: writeOperator,
      value,
      label,
    };
    filterSet.set(spec, { clients });
  };

  // Re-attach this client when it (re)mounts over an already-active selection
  // — e.g. after a Classic↔Builder switch or a link hydrate — so the new option
  // query self-excludes too. This MUST NOT mutate spec content: its only job is
  // re-associating the facet's own options client for self-exclusion, so it
  // re-sets the COMMITTED spec verbatim (value AND operator read from the store)
  // with `{ clients }` — never rebuilding from the prop operator, which would
  // silently invert a Builder-chosen `not_in` on a mere Classic dropdown open.
  // Keyed on the client identity, not `selected`: toggles already write with
  // `clients`.
  //
  // Then a corrective refetch. The re-attach `filterSet.set` above updates the
  // clause's `clients` via `Selection.update`, but that update is dispatched
  // ASYNCHRONOUSLY (Mosaic's AsyncDispatch queues it behind any in-flight emit)
  // AND `MosaicClient.requestQuery` captures the filter predicate at call time,
  // not at execution time. So the facet's first enabled query can read a
  // predicate that still carries the facet's OWN (previous, dead-mount) clause
  // — filtering the facet's own value out of its option list (e.g. reddit.com
  // vanishing from the Domain list after a Builder-authored not_in). That first
  // query cannot self-correct: the clause-clients update is deliberately skipped
  // for its own clients. We therefore AWAIT the filterBy selection's pending
  // dispatch (so the new clause-clients set has landed and `predicate(client)`
  // self-excludes), then force one refetch that re-reads the corrected
  // predicate. Keyed on the client identity: a remount / StrictMode revive /
  // structural recreation yields a new `clients` set and re-runs this.
  useEffect(() => {
    const committed = filterSet.store.state.specs.find(
      (entry) => entry.id === specId,
    );
    const isSelfReferential =
      committed !== undefined && Array.isArray(committed.value);
    if (isSelfReferential) {
      // Reading committed at effect time (not via the render-scope `selected`)
      // keeps this a pure re-attach — deps are the client identity + spec id.
      filterSet.set({ ...committed, id: specId }, { clients });
    } else {
      // No self-referential clause to correct: the plain enabled query already
      // reads a correct predicate.
      return;
    }
    let cancelled = false;
    // Wait for the clause-clients update to flush, then re-query against the
    // now self-excluding predicate.
    void page.pending('value').then(() => {
      if (!cancelled) {
        void facet.client.refetch();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clients, specId, facet.client, filterSet, page]);

  const toggle = (rawValue: unknown) => {
    const value = String(rawValue);
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    if (next.length === 0) {
      filterSet.remove(specId);
      return;
    }
    // Preserve the committed operator when it is a compatible multi-value
    // operator (a Builder-authored `not_in`/`list_has_all`/…); fall back to the
    // prop default when it is valueless (`is_empty`/`is_not_empty`) or absent.
    const nextOperator = isMultiValueOperator(committedOperator)
      ? committedOperator
      : operator;
    writeSpec(next, nextOperator);
  };

  // The ✕ button is a deliberate reset, not a keystroke: apply it immediately
  // (both the displayed and query-triggering value) and drop any pending
  // debounced search so a stale in-flight keystroke can't resurrect it.
  const clear = () => {
    searchDebounce.cancel();
    setSearch('');
    setDebouncedSearch('');
    filterSet.remove(specId);
  };

  return (
    <div className="flex flex-col gap-1" data-testid={`${props.testId}-value`}>
      <div className="flex items-center gap-1">
        <input
          aria-label={`${label} search`}
          className="h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm"
          placeholder={facetTriggerLabel(selected)}
          value={search}
          onChange={(event) => {
            const value = event.target.value;
            // Displayed value updates immediately; the query-triggering value
            // (including clearing back to '') is debounced consistently so a
            // burst of deletions doesn't re-fire the option query mid-way.
            setSearch(value);
            searchDebounce.run(() => setDebouncedSearch(value));
          }}
        />
        {selected.length > 0 ? (
          <button
            type="button"
            className="shrink-0 px-1 text-xs text-slate-400 hover:text-slate-700"
            aria-label={`Clear ${label} filter`}
            onClick={clear}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="max-h-40 min-w-[180px] overflow-y-auto rounded border border-slate-100 bg-white">
        {facet.options.length === 0 && facet.status !== 'pending' ? (
          <div className="py-3 text-center text-xs text-slate-400">
            No results.
          </div>
        ) : null}
        {facet.status === 'pending' && facet.options.length === 0 ? (
          <div className="py-3 text-center text-xs text-slate-400 italic">
            Loading options…
          </div>
        ) : null}
        {facet.options.map((option) => {
          // Under an exclusion operator the spec's values are filtered OUT, so
          // options are never rendered checked (see `isExclusionOperator`).
          const isSelected =
            !isExclusionOperator && selected.includes(String(option.value));
          return (
            <button
              key={String(option.value)}
              type="button"
              data-testid={`${props.testId}-option`}
              aria-pressed={isSelected}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-slate-100"
              onClick={() => toggle(option.value)}
            >
              <span className="w-4 text-cyan-700">{isSelected ? '✓' : ''}</span>
              <span className="truncate">
                {option.count === undefined
                  ? String(option.value)
                  : `${String(option.value)} (${option.count.toLocaleString()})`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
