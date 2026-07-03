/**
 * Top-bar filter inputs, all publishing into the page {@link filterSet}.
 *
 * Facet dropdowns ride the facet client (`useMosaicFacet` with `publish.into`),
 * gated on the dropdown being open. Text, date-range, and the min-domains
 * membership subquery are config-defined specs: each input reads its committed
 * value back from the set store (so chip removal / Clear All empties it) and
 * writes a spec (debounced) or removes it when empty.
 */
import { useEffect, useRef, useState } from 'react';
import { useFilterSetState, useMosaicFacet } from '@nozzleio/react-mosaic';
import { $page, filterSet, tableName } from '../page-context';
import type { FilterSpec } from '@nozzleio/react-mosaic';
import type { Selection } from '@uwdata/mosaic-core';

function FilterShell(props: {
  label: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    // shrink-0: fixed-width flex items must wrap to the next row rather than
    // shrink below their content and overlap their neighbors.
    <div
      className={`flex shrink-0 flex-col gap-1 ${props.width ?? 'w-[180px]'}`}
    >
      <label className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

/** Reads one spec's committed value from the set store (undefined when absent). */
function useSpecValue(id: string): unknown {
  const { specs } = useFilterSetState(filterSet);
  return specs.find((spec) => spec.id === id)?.value;
}

function useDebouncedRun(delayMs: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );
  return (run: () => void) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(run, delayMs);
  };
}

// ── Facet dropdowns ──────────────────────────────────────────────────────────

function FacetDropdown(props: {
  label: string;
  column: string;
  specId: string;
  filterBy: Selection;
  arrayColumn?: boolean;
  select: 'single' | 'multi';
  sort: 'count' | 'alpha';
  limit: number;
  enabled: boolean;
  testId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const facet = useMosaicFacet({
    from: tableName,
    column: props.column,
    arrayColumn: props.arrayColumn,
    select: props.select,
    sort: props.sort,
    filterBy: props.filterBy,
    publish: { into: filterSet, id: props.specId, label: props.label },
    inputs: { search, limit: props.limit },
    // Suppress background option queries while the menu is closed.
    enabled: props.enabled && isOpen,
  });
  const { selected } = facet;

  // Clear the search box when the selection is cleared externally
  // (chip removal, global reset).
  useEffect(() => {
    if (selected.length === 0) {
      setSearch('');
    }
  }, [selected]);

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const triggerLabel =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? String(selected[0])
        : `${selected.length} selected`;

  return (
    <FilterShell label={props.label} width="w-[200px]">
      <div className="relative" ref={containerRef} data-testid={props.testId}>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded border border-slate-200 bg-white px-3 text-sm font-normal"
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="ml-2 text-slate-400">▾</span>
        </button>
        {isOpen ? (
          <div className="absolute z-20 mt-1 w-full rounded border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center border-b border-slate-100 px-3">
              <input
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="Search…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {selected.length > 0 ? (
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-700"
                  aria-label={`Clear ${props.label} filter`}
                  onClick={() => facet.client.clear()}
                >
                  ✕
                </button>
              ) : null}
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              <FacetOptionRow
                label="All"
                isSelected={selected.length === 0}
                onClick={() => {
                  facet.client.clear();
                  setIsOpen(false);
                }}
              />
              {facet.options.map((option) => (
                <FacetOptionRow
                  key={String(option.value)}
                  label={
                    option.count === undefined
                      ? String(option.value)
                      : `${String(option.value)} (${option.count.toLocaleString()})`
                  }
                  isSelected={selected.some((value) => value === option.value)}
                  onClick={() => {
                    facet.client.toggle(option.value);
                    if (props.select === 'single') {
                      setIsOpen(false);
                    }
                  }}
                />
              ))}
              {facet.options.length === 0 && facet.status !== 'pending' ? (
                <div className="py-6 text-center text-sm text-slate-500">
                  No results found.
                </div>
              ) : null}
              {facet.status === 'pending' && facet.options.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-400 italic">
                  Loading options…
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </FilterShell>
  );
}

function FacetOptionRow(props: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-2 pl-8 text-left text-sm hover:bg-slate-100"
    >
      <span className="absolute -ml-6 w-4 text-cyan-700">
        {props.isSelected ? '✓' : ''}
      </span>
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export function DomainFilter(props: { enabled: boolean }) {
  return (
    <FacetDropdown
      label="Domain"
      column="domain"
      specId="facet:domain"
      filterBy={$page}
      select="single"
      sort="count"
      limit={50}
      enabled={props.enabled}
      testId="filter-domain"
    />
  );
}

export function DeviceFilter(props: { enabled: boolean }) {
  return (
    <FacetDropdown
      label="Device"
      column="device"
      specId="facet:device"
      filterBy={$page}
      select="single"
      sort="count"
      limit={50}
      enabled={props.enabled}
      testId="filter-device"
    />
  );
}

export function KeywordGroupFilter(props: { enabled: boolean }) {
  return (
    <FacetDropdown
      label="Keyword Group"
      column="keyword_groups"
      specId="facet:keyword-group"
      filterBy={$page}
      arrayColumn
      select="multi"
      sort="alpha"
      limit={100}
      enabled={props.enabled}
      testId="filter-keyword-group"
    />
  );
}

// ── Config-defined text filters ──────────────────────────────────────────────

interface TextFilterConfig {
  id: string;
  column: string;
  label: string;
}

const TEXT_FILTERS: Record<'phrase' | 'desc' | 'question', TextFilterConfig> = {
  phrase: { id: 'text:phrase', column: 'phrase', label: 'Keyword' },
  desc: { id: 'text:desc', column: 'description', label: 'Answer Text' },
  question: {
    id: 'text:question',
    column: 'related_phrase.phrase',
    label: 'Question',
  },
};

export function TextFilter(props: {
  label: string;
  runtime: 'phrase' | 'desc' | 'question';
  testId: string;
}) {
  const config = TEXT_FILTERS[props.runtime];
  const committed = useSpecValue(config.id);
  const [draft, setDraft] = useState('');
  const debounce = useDebouncedRun(300);

  // Mirror external changes (chip removal, Clear All) into the input.
  useEffect(() => {
    setDraft(typeof committed === 'string' ? committed : '');
  }, [committed]);

  return (
    <FilterShell label={props.label}>
      <input
        data-testid={props.testId}
        className="h-9 rounded border border-slate-200 bg-white px-3 text-sm"
        placeholder="Search…"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          debounce(() => {
            if (next === '') {
              filterSet.remove(config.id);
              return;
            }
            filterSet.set({
              id: config.id,
              column: config.column,
              kind: 'match',
              operator: 'contains',
              value: next,
              label: config.label,
            });
          });
        }}
      />
    </FilterShell>
  );
}

// ── Date range ───────────────────────────────────────────────────────────────

const DATE_SPEC_ID = 'date:requested';

export function DateRangeFilter() {
  const committed = useSpecValue(DATE_SPEC_ID);
  const bounds = Array.isArray(committed) ? committed : [null, null];
  const start = typeof bounds[0] === 'string' ? bounds[0] : '';
  const end = typeof bounds[1] === 'string' ? bounds[1] : '';

  const setRange = (nextStart: string, nextEnd: string) => {
    const lo = nextStart === '' ? null : nextStart;
    const hi = nextEnd === '' ? null : nextEnd;
    if (lo === null && hi === null) {
      filterSet.remove(DATE_SPEC_ID);
      return;
    }
    filterSet.set({
      id: DATE_SPEC_ID,
      column: 'requested',
      kind: 'interval',
      value: [lo, hi],
      label: 'Date Range',
    });
  };

  return (
    // Native date inputs have a wide intrinsic minimum; give the shell room
    // and let each input shrink (min-w-0) instead of overflowing the row.
    <FilterShell label="Requested Date" width="w-[310px]">
      <div className="flex items-center gap-2">
        <input
          type="date"
          data-testid="filter-date-start"
          className="h-9 w-full min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-cyan-600"
          value={start}
          onChange={(event) => setRange(event.target.value, end)}
        />
        <span className="shrink-0 text-slate-400">–</span>
        <input
          type="date"
          data-testid="filter-date-end"
          className="h-9 w-full min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-cyan-600"
          value={end}
          onChange={(event) => setRange(start, event.target.value)}
        />
      </div>
    </FilterShell>
  );
}

// ── Min-domains membership subquery ──────────────────────────────────────────

const MIN_DOMAINS_SPEC_ID = 'minDomains';

export function QuestionMinDomainsFilter() {
  const committed = useSpecValue(MIN_DOMAINS_SPEC_ID);
  const [draft, setDraft] = useState('');
  const debounce = useDebouncedRun(400);

  useEffect(() => {
    setDraft(
      typeof committed === 'number' || typeof committed === 'string'
        ? String(committed)
        : '',
    );
  }, [committed]);

  return (
    <FilterShell label="Question Domains" width="w-[150px]">
      <input
        data-testid="question-min-domains-input"
        type="number"
        min={1}
        placeholder="≥ N domains"
        className="h-9 rounded border border-slate-200 bg-white px-3 text-sm"
        value={draft}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          debounce(() => {
            if (raw === '') {
              filterSet.remove(MIN_DOMAINS_SPEC_ID);
              return;
            }
            const spec: FilterSpec = {
              id: MIN_DOMAINS_SPEC_ID,
              column: 'related_phrase.phrase',
              kind: 'min-domains',
              operator: 'gte',
              value: Number(raw),
              label: 'Min Domains',
            };
            filterSet.set(spec);
          });
        }}
      />
    </FilterShell>
  );
}
