/**
 * Top-bar Classic filter inputs, all authoring the page {@link filterSet}.
 *
 * The Classic view is a curated subset of the Builder — it must never limit it,
 * so every Classic control shares its canonical spec id + kind with the Builder
 * field of the same concept. In particular the Domain/Device/Keyword-Group
 * facet controls author `condition` specs (list `in` / array `list_has_any`),
 * NOT the old `point`/`points` shapes, so switching to the Builder hydrates
 * losslessly and the same spec exposes changeable operators there.
 *
 * Every facet control DERIVES its selection and trigger label from the
 * committed spec in the set store (via {@link FacetMultiSelect}), not from a
 * dropdown-gated facet client's `selected` — so a selection made in the Builder
 * (or hydrated from a link) shows immediately instead of a stale "All".
 *
 * Text, date-range, and the min-domains subquery are config-defined specs: each
 * reads its committed value back from the set store (so chip removal / Clear All
 * empties it) and writes a spec (debounced) or removes it when empty.
 */
import { useEffect, useRef, useState } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { usePageFilterSet } from '../topology';
import {
  facetTriggerLabel,
  useDebouncedRun,
  useSelectedValues,
} from '../filter-controls';
import { FacetMultiSelect } from './facet-multi-select';
import type { FilterSpec } from '@nozzleio/react-mosaic';

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
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  return specs.find((spec) => spec.id === id)?.value;
}

/** Reads one spec's committed operator from the set store (undefined when absent). */
function useSpecOperator(id: string): string | undefined {
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  return specs.find((spec) => spec.id === id)?.operator;
}

// ── Facet dropdowns (spec-driven, multi-select) ───────────────────────────────

/**
 * A Classic facet dropdown: a trigger button whose label reflects the committed
 * spec's selection, opening the shared {@link FacetMultiSelect} list. Both the
 * label and the checkmarks read the spec, so a Builder edit shows here instantly.
 */
function FacetDropdown(props: {
  label: string;
  column: string;
  specId: string;
  operator: string;
  arrayColumn?: boolean;
  sort: 'count' | 'alpha';
  limit: number;
  enabled: boolean;
  testId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = useSelectedValues(props.specId);

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

  const triggerLabel = facetTriggerLabel(selected);

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
          <div className="absolute z-20 mt-1 w-full rounded border border-slate-200 bg-white p-1 shadow-lg">
            <FacetMultiSelect
              specId={props.specId}
              column={props.column}
              arrayColumn={props.arrayColumn}
              label={props.label}
              operator={props.operator}
              sort={props.sort}
              limit={props.limit}
              enabled={props.enabled && isOpen}
              testId={props.testId}
            />
          </div>
        ) : null}
      </div>
    </FilterShell>
  );
}

export function DomainFilter(props: { enabled: boolean }) {
  return (
    <FacetDropdown
      label="Domain"
      column="domain"
      specId="facet:domain"
      operator="in"
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
      operator="in"
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
      operator="list_has_any"
      arrayColumn
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

const TEXT_FILTERS: Record<'phrase' | 'question', TextFilterConfig> = {
  phrase: { id: 'text:phrase', column: 'phrase', label: 'Phrase' },
  question: {
    id: 'text:question',
    column: 'related_phrase.phrase',
    label: 'Question',
  },
};

export function TextFilter(props: {
  label: string;
  runtime: 'phrase' | 'question';
  testId: string;
}) {
  const filterSet = usePageFilterSet();
  const config = TEXT_FILTERS[props.runtime];
  const committed = useSpecValue(config.id);
  const committedOperator = useSpecOperator(config.id);
  // Divergence: the shared spec exists with an operator this contains-only
  // control can't represent (anything but `contains`). Keyed on spec existence
  // + operator — an `is_empty` spec has no value but is still an active filter.
  const builderHint =
    committedOperator !== undefined && committedOperator !== 'contains';
  const [draft, setDraft] = useState('');
  const debounce = useDebouncedRun(300);

  // Mirror external changes (chip removal, Clear All, a `contains` edit from the
  // Builder) into the input. A non-contains operator leaves the box empty; the
  // hint tells the user the real filter lives in the Builder.
  useEffect(() => {
    if (builderHint) {
      setDraft('');
      return;
    }
    setDraft(typeof committed === 'string' ? committed : '');
  }, [committed, builderHint]);

  return (
    <FilterShell label={props.label}>
      {builderHint ? (
        <span
          data-testid={`${props.testId}-builder-hint`}
          className="text-[11px] font-medium text-cyan-700"
          title="This field has a filter set in the Builder view with an operator the classic control can't show."
        >
          set in builder
        </span>
      ) : null}
      <input
        data-testid={props.testId}
        className="h-9 rounded border border-slate-200 bg-white px-3 text-sm"
        placeholder="Search…"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          debounce.run(() => {
            if (next === '') {
              filterSet.remove(config.id);
              return;
            }
            // Author the SAME `condition` spec the Builder Phrase/Question
            // fields do (contains), so the two views converge on one spec.
            filterSet.set({
              id: config.id,
              column: config.column,
              kind: 'condition',
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
  const filterSet = usePageFilterSet();
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
  const filterSet = usePageFilterSet();
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
          debounce.run(() => {
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
