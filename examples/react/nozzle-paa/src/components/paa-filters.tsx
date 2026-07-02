/**
 * Top-bar filter inputs. Facet dropdowns ride the facet client
 * (`useMosaicFacet`, gated on the dropdown being open); text, date-range,
 * and the min-domains membership subquery ride the ported filter-builder
 * (`useFilterBinding`), whose committed state syncs back from the Selection
 * so chip removal and global reset clear the inputs automatically.
 */
import { useEffect, useRef, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import { useFilterBinding, useMosaicFacet } from '@nozzleio/react-mosaic';
import { $inputs, facetContexts, tableName } from '../page-context';
import type {
  DateRangeFilterDefinition,
  FilterRuntime,
  NumberFilterDefinition,
  TextFilterDefinition,
} from '@nozzleio/react-mosaic';
import type { Selection } from '@uwdata/mosaic-core';

const SCOPE_ID = 'paa';

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

// ── Facet dropdowns ──────────────────────────────────────────────────────────

function FacetDropdown(props: {
  label: string;
  column: string;
  selection: Selection;
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
    publish: { as: props.selection },
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
      selection={$inputs.domain}
      filterBy={facetContexts.domain}
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
      selection={$inputs.device}
      filterBy={facetContexts.device}
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
      selection={$inputs.keywordGroup}
      filterBy={facetContexts.keywordGroup}
      arrayColumn
      select="multi"
      sort="alpha"
      limit={100}
      enabled={props.enabled}
      testId="filter-keyword-group"
    />
  );
}

// ── Filter-builder inputs (text / date range / membership subquery) ─────────

function textDefinition(
  id: string,
  label: string,
  column: string,
): TextFilterDefinition {
  return {
    id,
    label,
    column,
    valueKind: 'text',
    operators: ['contains'],
  };
}

const TEXT_RUNTIMES: Record<'phrase' | 'desc' | 'question', FilterRuntime> = {
  phrase: {
    definition: textDefinition('phrase', 'Phrase', 'phrase'),
    selection: $inputs.phrase,
    scopeId: SCOPE_ID,
  },
  desc: {
    definition: textDefinition('desc', 'Answer Contains', 'description'),
    selection: $inputs.desc,
    scopeId: SCOPE_ID,
  },
  question: {
    definition: textDefinition(
      'question',
      'Question Contains',
      'related_phrase.phrase',
    ),
    selection: $inputs.question,
    scopeId: SCOPE_ID,
  },
};

function useDebouncedApply(apply: () => void, delayMs: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );
  return () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(apply, delayMs);
  };
}

export function TextFilter(props: {
  label: string;
  runtime: 'phrase' | 'desc' | 'question';
  testId: string;
}) {
  const binding = useFilterBinding(TEXT_RUNTIMES[props.runtime]);
  const debouncedApply = useDebouncedApply(binding.apply, 300);

  return (
    <FilterShell label={props.label}>
      <input
        data-testid={props.testId}
        className="h-9 rounded border border-slate-200 bg-white px-3 text-sm"
        placeholder="Search…"
        value={typeof binding.value === 'string' ? binding.value : ''}
        onChange={(event) => {
          binding.setValue(event.target.value);
          debouncedApply();
        }}
      />
    </FilterShell>
  );
}

const DATE_DEFINITION: DateRangeFilterDefinition = {
  id: 'requested',
  label: 'Requested Date',
  column: 'requested',
  valueKind: 'date-range',
  operators: ['between'],
};

const DATE_RUNTIME: FilterRuntime = {
  definition: DATE_DEFINITION,
  selection: $inputs.date,
  scopeId: SCOPE_ID,
};

export function DateRangeFilter() {
  const binding = useFilterBinding(DATE_RUNTIME);
  const [start, end] = Array.isArray(binding.value)
    ? [binding.value[0] ?? '', binding.value[1] ?? '']
    : ['', ''];

  const setRange = (nextStart: string, nextEnd: string) => {
    binding.setValue([nextStart || null, nextEnd || null]);
    binding.apply();
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
          value={typeof start === 'string' ? start : ''}
          onChange={(event) =>
            setRange(event.target.value, typeof end === 'string' ? end : '')
          }
        />
        <span className="shrink-0 text-slate-400">–</span>
        <input
          type="date"
          data-testid="filter-date-end"
          className="h-9 w-full min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-cyan-600"
          value={typeof end === 'string' ? end : ''}
          onChange={(event) =>
            setRange(typeof start === 'string' ? start : '', event.target.value)
          }
        />
      </div>
    </FilterShell>
  );
}

/**
 * Membership-subquery filter: keep rows whose PAA question appears on at
 * least N distinct domains. The filter-builder's `subquery` mode publishes
 *
 *   related_phrase.phrase IN (
 *     SELECT related_phrase.phrase FROM nozzle_paa
 *     GROUP BY 1 HAVING count(DISTINCT domain) >= N)
 */
const MIN_DOMAINS_DEFINITION: NumberFilterDefinition = {
  id: 'question-min-domains',
  label: 'Question Domains',
  column: 'related_phrase.phrase',
  valueKind: 'number',
  operators: ['gte'],
  subquery: ({ state }) => {
    const minDomains = Number(state.value);
    if (!Number.isFinite(minDomains) || minDomains <= 0) {
      return null;
    }
    const questionExpr = mSql.sql`"related_phrase"."phrase"`;
    return mSql.Query.select({ question: questionExpr })
      .from(tableName)
      .groupby(questionExpr)
      .having(mSql.gte(mSql.count('domain').distinct(), minDomains));
  },
};

const MIN_DOMAINS_RUNTIME: FilterRuntime = {
  definition: MIN_DOMAINS_DEFINITION,
  selection: $inputs.questionDomains,
  scopeId: SCOPE_ID,
};

export function QuestionMinDomainsFilter() {
  const binding = useFilterBinding(MIN_DOMAINS_RUNTIME);
  const debouncedApply = useDebouncedApply(binding.apply, 400);

  const value =
    typeof binding.value === 'number' || typeof binding.value === 'string'
      ? binding.value
      : '';

  return (
    <FilterShell label="Question Domains" width="w-[150px]">
      <input
        data-testid="question-min-domains-input"
        type="number"
        min={1}
        placeholder="≥ N domains"
        className="h-9 rounded border border-slate-200 bg-white px-3 text-sm"
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          binding.setValue(raw === '' ? null : Number(raw));
          debouncedApply();
        }}
      />
    </FilterShell>
  );
}
