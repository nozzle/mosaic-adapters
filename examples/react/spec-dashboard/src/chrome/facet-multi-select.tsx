/**
 * The shared facet multi-select control used by the FilterBuilder's facet value
 * editors.
 *
 * It is the mechanism that keeps the builder and the committed FilterSet on a
 * single spec:
 *
 * - **Options + counts** come from {@link useMosaicFacet} in read-only mode (no
 *   `publish`), cascaded by the page context Selection — so the list narrows as
 *   other filters change, but it never owns the selection.
 * - **The current selection + trigger label** are DERIVED from the committed
 *   `condition` spec in the {@link FilterSet} store (via `useFilterSetState`),
 *   NOT from the facet client's `selected` (which is empty while the client is
 *   idle). This keeps the label/checkmarks correct even before any option query.
 * - **Toggling** writes a `condition` spec (`{ id, column, kind:'condition',
 *   operator, value: string[], label }`) via `filterSet.set` and
 *   `filterSet.remove(id)` when the selection empties.
 *
 * Self-exclusion: this option query's client is registered as the spec's clause
 * source (`filterSet.set(spec, { clients })`), so under the page crossfilter
 * context the facet's own list is cascaded by every OTHER filter but not by its
 * own selection — without it, picking one value collapses the list to that
 * value's co-occurring values and a second pick is impossible.
 */
import { useEffect, useMemo, useState } from 'react';
import { useFilterSetState, useMosaicFacet } from '@nozzleio/react-mosaic';
import type { Selection } from '@uwdata/mosaic-core';
import type { FilterSet, FilterSpec } from '@nozzleio/react-mosaic';

/**
 * Multi-value operators whose value list is a set of EXCLUSIONS rather than
 * inclusions. Under these no option is rendered checked: the excluded values
 * appear as ordinary, still-toggleable options.
 */
const EXCLUSION_OPERATORS = new Set<string>(['not_in', 'excludes_all']);

/**
 * The multi-value `condition` operators the facet control can preserve when
 * toggling a value. Emptiness operators (`is_empty`/`is_not_empty`, arity
 * `none`) carry no value list, so the caller hides this control for them.
 */
const MULTI_VALUE_OPERATORS = new Set([
  'in',
  'not_in',
  'list_has_any',
  'list_has_all',
  'excludes_all',
]);

function isMultiValueOperator(operator: unknown): operator is string {
  return typeof operator === 'string' && MULTI_VALUE_OPERATORS.has(operator);
}

/** The trigger/placeholder label: `All` when empty, the value when one, else `N selected`. */
function facetTriggerLabel(selected: Array<string>): string {
  if (selected.length === 0) {
    return 'All';
  }
  if (selected.length === 1) {
    return String(selected[0]);
  }
  return `${selected.length} selected`;
}

export interface FacetMultiSelectProps {
  /** Canonical spec id (shared with the placement that writes it). */
  specId: string;
  /** Column (or struct path) the facet enumerates and the spec filters. */
  column: string;
  /** Base relation the option query reads. */
  table: string;
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
  /** `data-testid` root; option buttons get `${testId}-option`. */
  testId: string;
  /** The page filter set this control writes into. */
  filterSet: FilterSet;
  /** The page context Selection the option list cascades by (self-excluded). */
  page: Selection | undefined;
}

export function FacetMultiSelect(props: FacetMultiSelectProps) {
  const { specId, column, label, operator, filterSet, page } = props;
  const [search, setSearch] = useState('');

  // Read-only options + cascade counts — NO publish; the spec store owns state.
  const facet = useMosaicFacet({
    from: props.table,
    column,
    arrayColumn: props.arrayColumn,
    select: 'multi',
    sort: props.sort,
    ...(page !== undefined ? { filterBy: page } : {}),
    inputs: { search, limit: props.limit },
    enabled: props.enabled,
  });

  // Register THIS option query's client as the spec's clause source so the
  // facet's own list is cascaded by every OTHER filter but not its own value.
  const clients = useMemo(
    () => new Set([facet.client.mosaicClient]),
    [facet.client],
  );

  // The committed spec drives selection + operator, so both stay correct even
  // while this facet client is idle.
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((entry) => entry.id === specId);
  const selected = useMemo(() => {
    if (committed === undefined || !Array.isArray(committed.value)) {
      return [];
    }
    return committed.value.map((value) => String(value));
  }, [committed]);

  const effectiveOperator =
    typeof committed?.operator === 'string' ? committed.operator : operator;
  const isExclusionOperator = EXCLUSION_OPERATORS.has(effectiveOperator);

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

  // Re-attach this client when it (re)mounts over an already-active selection so
  // the new option query self-excludes. This MUST NOT mutate spec content: it
  // re-sets the COMMITTED spec verbatim with `{ clients }`. Then, because the
  // clause-clients update dispatches asynchronously and the first query captures
  // the predicate at call time, await the page selection's pending dispatch and
  // force one refetch against the now self-excluding predicate.
  useEffect(() => {
    const current = filterSet.store.state.specs.find(
      (entry) => entry.id === specId,
    );
    if (current === undefined || !Array.isArray(current.value)) {
      return;
    }
    filterSet.set({ ...current, id: specId }, { clients });
    if (page === undefined) {
      void facet.client.refetch();
      return;
    }
    let cancelled = false;
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
    const nextOperator = isMultiValueOperator(committed?.operator)
      ? committed.operator
      : operator;
    writeSpec(next, nextOperator);
  };

  const clear = () => {
    setSearch('');
    filterSet.remove(specId);
  };

  return (
    <div className="flex flex-col gap-1" data-testid={`${props.testId}-value`}>
      <div className="flex items-center gap-1">
        <input
          aria-label={`${label} search`}
          className="h-7 w-full rounded-gf border border-line bg-field px-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          placeholder={facetTriggerLabel(selected)}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selected.length > 0 ? (
          <button
            type="button"
            className="shrink-0 px-1 text-xs text-faint hover:text-ink"
            aria-label={`Clear ${label} filter`}
            onClick={clear}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="max-h-40 min-w-[180px] overflow-y-auto rounded-gf border border-line bg-panel">
        {facet.options.length === 0 && facet.status !== 'pending' ? (
          <div className="py-3 text-center text-xs text-faint">No results.</div>
        ) : null}
        {facet.status === 'pending' && facet.options.length === 0 ? (
          <div className="py-3 text-center text-xs text-faint italic">
            Loading options…
          </div>
        ) : null}
        {facet.options.map((option) => {
          const isSelected =
            !isExclusionOperator && selected.includes(String(option.value));
          return (
            <button
              key={String(option.value)}
              type="button"
              data-testid={`${props.testId}-option`}
              aria-pressed={isSelected}
              className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-ink hover:bg-hover"
              onClick={() => toggle(option.value)}
            >
              <span className="w-4 text-gf-blue">{isSelected ? '✓' : ''}</span>
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
