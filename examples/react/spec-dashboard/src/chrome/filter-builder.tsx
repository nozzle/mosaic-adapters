/**
 * The spec-driven filter builder — the only filter authoring surface on the
 * page, driven from `spec.filters.fields`.
 *
 * The user picks a field from the spec's field list; each pick appends a filter
 * block (one per field id). A block flows:
 *
 *   placement → kind → operators (`kindRegistry[kind].operators`) → arity →
 *   value control (by `valueKind`) → `filterSet.set(spec)` (debounced text /
 *   immediate facets), writing the placement's canonical `specId` into the
 *   primary FilterSet.
 *
 * Blocks hydrate from committed specs, so a re-render or a spec re-apply reopens
 * every field that already holds a spec on the current set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { FacetMultiSelect } from './facet-multi-select';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  FilterKind,
  FilterSet,
  FilterSpec,
  OperatorArity,
  OperatorDescriptor,
} from '@nozzleio/react-mosaic';
import type { FilterFieldSpec, FilterPlacementSpec } from '../spec/schema';

/** The kind registry the builder resolves operators against (built by `compile`). */
export type KindRegistry = Record<string, FilterKind>;

const inputClassName =
  'h-7 rounded-gf border border-line bg-field px-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue';
const selectClassName =
  'h-7 rounded-gf border border-line bg-field px-2 text-xs text-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue';
const labelClassName =
  'text-[11px] font-medium tracking-wide text-muted uppercase';

/**
 * The operator subset a facet field exposes. The `condition` kind advertises the
 * full vocabulary; a facet control only makes sense for membership + emptiness
 * (scalar) or the array operators (array column).
 */
const FACET_SCALAR_OPERATORS = ['in', 'not_in', 'is_empty', 'is_not_empty'];
const FACET_ARRAY_OPERATORS = ['list_has_any', 'list_has_all', 'excludes_all'];

function isFacetField(field: FilterFieldSpec): boolean {
  return field.value_kind === 'facet';
}

/** The operators a placement's block offers. */
function operatorsForBlock(
  field: FilterFieldSpec,
  placement: FilterPlacementSpec,
  kindRegistry: KindRegistry,
): ReadonlyArray<OperatorDescriptor> {
  const declared = kindRegistry[placement.kind]?.operators ?? [];
  if (!isFacetField(field)) {
    return declared;
  }
  const subset =
    field.array_column === true
      ? FACET_ARRAY_OPERATORS
      : FACET_SCALAR_OPERATORS;
  return subset
    .map((id) => declared.find((entry) => entry.id === id))
    .filter((entry): entry is OperatorDescriptor => entry !== undefined);
}

/** The operator a scalar block opens on (text prefers `contains`). */
function defaultOperatorId(
  field: FilterFieldSpec,
  operators: ReadonlyArray<OperatorDescriptor>,
): string {
  if (
    field.value_kind === 'text' &&
    operators.some((entry) => entry.id === 'contains')
  ) {
    return 'contains';
  }
  return operators[0]?.id ?? '';
}

/** The label shown for the current operator (static-control fallback). */
function operatorLabel(
  operators: ReadonlyArray<OperatorDescriptor>,
  operatorId: string,
): string {
  return (
    operators.find((entry) => entry.id === operatorId)?.label ?? operatorId
  );
}

/** Coerce a raw text entry to the field's value type (numbers for number fields). */
function coerce(field: FilterFieldSpec, raw: string): string | number {
  if (field.value_kind === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

/**
 * A debounced runner with an explicit cancel handle. The cancel handle is
 * load-bearing: a placement switch (or external removal) must abort a pending
 * publish before it resurrects a spec the switch just removed.
 */
function useDebouncedRun(delayMs: number): {
  run: (fn: () => void) => void;
  cancel: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(
    (fn: () => void) => {
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fn();
      }, delayMs);
    },
    [cancel, delayMs],
  );
  return useMemo(() => ({ run, cancel }), [run, cancel]);
}

/**
 * Fields to keep open: any currently open, plus any that now hold a spec.
 * Returns `prev` unchanged (referentially) when nothing was added.
 */
function hydrateOpenFields(
  fields: ReadonlyArray<FilterFieldSpec>,
  committedSpecs: ReadonlyArray<FilterSpec>,
  prev: Array<string>,
): Array<string> {
  const added: Array<string> = [];
  for (const field of fields) {
    if (prev.includes(field.id)) {
      continue;
    }
    const hasSpec = field.placements.some((placement) =>
      committedSpecs.some((spec) => spec.id === placement.spec_id),
    );
    if (hasSpec) {
      added.push(field.id);
    }
  }
  return added.length === 0 ? prev : [...prev, ...added];
}

export interface FilterBuilderProps {
  fields: ReadonlyArray<FilterFieldSpec>;
  filterSet: FilterSet;
  /** Built-ins + spec-instantiated kinds; the block's operator dropdown reads it. */
  kindRegistry: KindRegistry;
  /**
   * Kind names that emit their own routing targets (`having:`/`members:`) and
   * ignore `spec.target` — a placement using one needs no explicit `spec.target`.
   */
  selfRoutingKinds: ReadonlySet<string>;
  /** The page context Selection the facet options cascade by. */
  page: Selection | undefined;
  /** Default facet option-query table when a field omits `facet_table`. */
  defaultFacetTable: string;
  /** Gate the facet option queries on page readiness. */
  enabled: boolean;
}

export function FilterBuilder(props: FilterBuilderProps) {
  const { fields, filterSet } = props;
  const { specs } = useFilterSetState(filterSet);
  const [openFieldIds, setOpenFieldIds] = useState<Array<string>>(() =>
    hydrateOpenFields(fields, specs, []),
  );

  // Merge in any field that now holds a committed spec (hydration / re-apply)
  // during render. `hydrateOpenFields` returns `prev` unchanged when nothing was
  // added, so this settles in a single pass with no re-render loop. `specs` (from
  // `useFilterSetState`) re-renders this on every committed-set change, keeping
  // the merge live.
  const hydratedOpenFieldIds = hydrateOpenFields(fields, specs, openFieldIds);
  if (hydratedOpenFieldIds !== openFieldIds) {
    setOpenFieldIds(hydratedOpenFieldIds);
  }

  const openFields = useMemo(
    () =>
      openFieldIds
        .map((id) => fields.find((field) => field.id === id))
        .filter((field): field is FilterFieldSpec => field !== undefined),
    [openFieldIds, fields],
  );

  const addField = (fieldId: string) => {
    setOpenFieldIds((prev) =>
      prev.includes(fieldId) ? prev : [...prev, fieldId],
    );
  };

  const removeField = (field: FilterFieldSpec) => {
    for (const placement of field.placements) {
      filterSet.remove(placement.spec_id);
    }
    setOpenFieldIds((prev) => prev.filter((id) => id !== field.id));
  };

  const available = fields.filter((field) => !openFieldIds.includes(field.id));

  return (
    <div className="flex w-full flex-col gap-2" data-testid="filter-builder">
      <div className="flex flex-wrap items-center gap-2">
        <span className={labelClassName}>Filter</span>
        <select
          data-testid="filter-builder-add-field"
          aria-label="Add filter field"
          className={selectClassName}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') {
              addField(event.target.value);
            }
          }}
        >
          <option value="">+ Add field…</option>
          {available.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-faint">
          Pick a field, then choose where it applies (row-level WHERE vs
          aggregate HAVING), how it compares, and its value.
        </p>
      </div>

      {openFields.length > 0 ? (
        <div className="flex flex-col gap-2">
          {openFields.map((field) => (
            <FilterBlock
              key={field.id}
              field={field}
              filterSet={filterSet}
              kindRegistry={props.kindRegistry}
              selfRoutingKinds={props.selfRoutingKinds}
              page={props.page}
              defaultFacetTable={props.defaultFacetTable}
              enabled={props.enabled}
              onRemove={() => removeField(field)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── One filter block ─────────────────────────────────────────────────────────

interface BlockProps {
  field: FilterFieldSpec;
  filterSet: FilterSet;
  kindRegistry: KindRegistry;
  selfRoutingKinds: ReadonlySet<string>;
  page: Selection | undefined;
  defaultFacetTable: string;
  enabled: boolean;
  onRemove: () => void;
}

function FilterBlock(props: BlockProps) {
  const { field, filterSet } = props;
  const testId = `filter-block-${field.id}`;

  // Seed once on mount to the placement that already holds a committed spec (if
  // any); the mirror effects handle live sync thereafter, so this must not re-run
  // as specs change — a lazy initializer guarantees exactly that.
  const [placementIndex, setPlacementIndex] = useState(() => {
    const withSpec = field.placements.findIndex((placement) =>
      filterSet.store.state.specs.some((spec) => spec.id === placement.spec_id),
    );
    return withSpec === -1 ? 0 : withSpec;
  });
  const placement = field.placements[placementIndex] ?? field.placements[0]!;

  const operators = useMemo(
    () => operatorsForBlock(field, placement, props.kindRegistry),
    [field, placement, props.kindRegistry],
  );

  const specColumn = placement.spec_column ?? field.column;
  const singlePlacement = field.placements.length === 1;

  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-2 rounded-gf border border-line bg-panel-header px-2 py-1.5"
    >
      <span className="text-xs font-medium text-ink">{field.label}</span>

      {/* Placement control is ALWAYS shown; disabled when there is only one. */}
      <select
        data-testid={`${testId}-placement`}
        aria-label={`${field.label} placement`}
        className={selectClassName}
        disabled={singlePlacement}
        value={String(placementIndex)}
        onChange={(event) => {
          const nextIndex = Number(event.target.value);
          const prevPlacement = field.placements[placementIndex];
          if (prevPlacement !== undefined) {
            filterSet.remove(prevPlacement.spec_id);
          }
          setPlacementIndex(nextIndex);
        }}
      >
        {field.placements.map((entry, index) => (
          <option key={entry.spec_id} value={String(index)}>
            {entry.label}
          </option>
        ))}
      </select>

      {/* Key value controls by the active placement's spec id so switching
          placement REMOUNTS them (cancels a pending debounce for the outgoing
          spec that the switch just removed). */}
      {isFacetField(field) ? (
        <FacetValue
          key={placement.spec_id}
          field={field}
          placement={placement}
          specColumn={specColumn}
          operators={operators}
          testId={testId}
          filterSet={filterSet}
          page={props.page}
          defaultFacetTable={props.defaultFacetTable}
          enabled={props.enabled}
        />
      ) : field.value_kind === 'date' ? (
        <DateRangeValue
          key={placement.spec_id}
          field={field}
          placement={placement}
          testId={testId}
          filterSet={filterSet}
        />
      ) : (
        <ScalarValue
          key={placement.spec_id}
          field={field}
          placement={placement}
          specColumn={specColumn}
          operators={operators}
          testId={testId}
          filterSet={filterSet}
          selfRoutingKinds={props.selfRoutingKinds}
        />
      )}

      <button
        type="button"
        data-testid={`${testId}-remove`}
        aria-label={`Remove ${field.label} filter`}
        className="ml-auto flex h-6 w-6 items-center justify-center rounded-gf text-faint hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
        onClick={props.onRemove}
      >
        ✕
      </button>
    </div>
  );
}

// ── The shared operator control ────────────────────────────────────────────────

function OperatorSelect(props: {
  operators: ReadonlyArray<OperatorDescriptor>;
  operatorId: string;
  onChange: (next: string) => void;
  staticLabel: string;
  fieldLabel: string;
  testId: string;
}) {
  const { operators } = props;
  if (operators.length === 0) {
    return (
      <select
        data-testid={`${props.testId}-operator`}
        aria-label={`${props.fieldLabel} operator`}
        className={selectClassName}
        disabled
        value="__static"
      >
        <option value="__static">{props.staticLabel}</option>
      </select>
    );
  }
  return (
    <select
      data-testid={`${props.testId}-operator`}
      aria-label={`${props.fieldLabel} operator`}
      className={selectClassName}
      disabled={operators.length === 1}
      value={props.operatorId}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {operators.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.label ?? entry.id}
        </option>
      ))}
    </select>
  );
}

// ── Scalar (text / number) value control ───────────────────────────────────────

function ScalarValue(props: {
  field: FilterFieldSpec;
  placement: FilterPlacementSpec;
  specColumn: string;
  operators: ReadonlyArray<OperatorDescriptor>;
  testId: string;
  filterSet: FilterSet;
  selfRoutingKinds: ReadonlySet<string>;
}) {
  const { field, placement, specColumn, operators, testId, filterSet } = props;
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.spec_id);

  // Seed the drafts from the committed spec on mount (hydration); the mirror
  // block below keeps them in sync on later external transitions.
  const [operatorId, setOperatorId] = useState<string>(() => {
    if (
      committed !== undefined &&
      typeof committed.operator === 'string' &&
      operators.some((entry) => entry.id === committed.operator)
    ) {
      return committed.operator;
    }
    return defaultOperatorId(field, operators);
  });
  const [value, setValue] = useState(() =>
    committed?.value === undefined ? '' : String(committed.value),
  );
  const [valueTo, setValueTo] = useState(() =>
    committed?.valueTo === undefined ? '' : String(committed.valueTo),
  );
  const debounce = useDebouncedRun(300);

  // A debounced write in flight; the mirror leaves the drafts alone while true so
  // it never fights what the user is typing. State (not a ref) so the mirror can
  // read it during render.
  const [pendingWrite, setPendingWrite] = useState(false);
  const committedExists = committed !== undefined;

  // When the operator vocabulary changes (e.g. a placement switch) and the
  // current operator is no longer offered, fall back to the default. Adjusted
  // during render — the standard "adjust state when a prop changes" pattern —
  // keyed on the `operators` identity so it runs once per change.
  const [operatorsForFallback, setOperatorsForFallback] = useState(operators);
  if (operators !== operatorsForFallback) {
    setOperatorsForFallback(operators);
    if (!operators.some((entry) => entry.id === operatorId)) {
      setOperatorId(defaultOperatorId(field, operators));
    }
  }

  // Mirror the committed spec → controls (hydration + external removal). Adjusted
  // during render — the "adjust state when a prop changes" pattern — keyed ONLY
  // on spec-existence transitions / placement changes, so live value edits (which
  // change neither) never clobber what the user is typing. The pending-ref guard
  // additionally leaves an in-flight debounced edit untouched. (The old effect
  // also called `debounce.cancel()` on the removal branch, but that branch is
  // only reached when no write is pending — i.e. no live timer exists — so it was
  // a no-op and is dropped here.)
  const [mirrorKey, setMirrorKey] = useState({
    specId: placement.spec_id,
    exists: committedExists,
  });
  if (
    mirrorKey.specId !== placement.spec_id ||
    mirrorKey.exists !== committedExists
  ) {
    setMirrorKey({ specId: placement.spec_id, exists: committedExists });
    if (!pendingWrite) {
      if (committed === undefined) {
        setValue('');
        setValueTo('');
        setOperatorId(defaultOperatorId(field, operators));
      } else {
        if (
          typeof committed.operator === 'string' &&
          operators.some((entry) => entry.id === committed.operator)
        ) {
          setOperatorId(committed.operator);
        }
        setValue(committed.value === undefined ? '' : String(committed.value));
        setValueTo(
          committed.valueTo === undefined ? '' : String(committed.valueTo),
        );
      }
    }
  }

  const operator = operators.find((entry) => entry.id === operatorId) ?? null;
  const arity: OperatorArity = operator?.arity ?? 'unary';

  const buildSpec = (
    nextOperatorId: string,
    nextValue: string,
    nextValueTo: string,
  ): FilterSpec | null => {
    const active = operators.find((entry) => entry.id === nextOperatorId);
    const nextArity: OperatorArity = active?.arity ?? 'unary';

    const spec: FilterSpec = {
      id: placement.spec_id,
      column: specColumn,
      kind: placement.kind,
      operator: nextOperatorId,
      label: field.label,
    };
    if (
      placement.target !== 'where' &&
      !props.selfRoutingKinds.has(placement.kind)
    ) {
      spec.target = placement.target;
    }

    if (nextArity === 'none') {
      return spec;
    }
    if (nextArity === 'range') {
      if (nextValue.trim() === '' || nextValueTo.trim() === '') {
        return null;
      }
      spec.value = coerce(field, nextValue.trim());
      spec.valueTo = coerce(field, nextValueTo.trim());
      return spec;
    }
    if (nextArity === 'set') {
      const items = nextValue
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
        .map((entry) => coerce(field, entry));
      if (items.length === 0) {
        return null;
      }
      spec.value = items;
      return spec;
    }
    if (nextValue.trim() === '') {
      return null;
    }
    spec.value = coerce(field, nextValue.trim());
    return spec;
  };

  const publish = (
    nextOperatorId: string,
    nextValue: string,
    nextValueTo: string,
    immediate: boolean,
  ) => {
    const run = () => {
      setPendingWrite(false);
      const spec = buildSpec(nextOperatorId, nextValue, nextValueTo);
      if (spec === null) {
        filterSet.remove(placement.spec_id);
        return;
      }
      filterSet.set(spec);
    };
    if (immediate) {
      debounce.cancel();
      setPendingWrite(false);
      run();
      return;
    }
    setPendingWrite(true);
    debounce.run(run);
  };

  return (
    <>
      <OperatorSelect
        operators={operators}
        operatorId={operatorId}
        onChange={(next) => {
          setOperatorId(next);
          publish(next, value, valueTo, true);
        }}
        staticLabel={operatorLabel(operators, operatorId)}
        fieldLabel={field.label}
        testId={testId}
      />

      {arity === 'none' ? null : (
        <input
          data-testid={`${testId}-value`}
          aria-label={`${field.label} value`}
          type={field.value_kind === 'number' ? 'number' : 'text'}
          className={inputClassName}
          placeholder={arity === 'set' ? 'a, b, c' : 'Value…'}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            publish(operatorId, next, valueTo, false);
          }}
        />
      )}

      {arity === 'range' ? (
        <input
          data-testid={`${testId}-value-to`}
          aria-label={`${field.label} upper bound`}
          type={field.value_kind === 'number' ? 'number' : 'text'}
          className={inputClassName}
          placeholder="…to"
          value={valueTo}
          onChange={(event) => {
            const next = event.target.value;
            setValueTo(next);
            publish(operatorId, value, next, false);
          }}
        />
      ) : null}
    </>
  );
}

// ── Facet multi-select value control ───────────────────────────────────────────

function FacetValue(props: {
  field: FilterFieldSpec;
  placement: FilterPlacementSpec;
  specColumn: string;
  operators: ReadonlyArray<OperatorDescriptor>;
  testId: string;
  filterSet: FilterSet;
  page: Selection | undefined;
  defaultFacetTable: string;
  enabled: boolean;
}) {
  const { field, placement, specColumn, operators, testId, filterSet } = props;
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.spec_id);

  const [operatorId, setOperatorId] = useState<string>(
    () => committed?.operator ?? operators[0]?.id ?? '',
  );

  // Reflect the committed operator (or reset to the first offered) when the
  // committed spec or operator vocabulary changes. Adjusted during render — the
  // "adjust state when a prop changes" pattern — keyed on both identities.
  const [reconciled, setReconciled] = useState<{
    committed: FilterSpec | undefined;
    operators: ReadonlyArray<OperatorDescriptor>;
  }>({ committed, operators });
  if (
    reconciled.committed !== committed ||
    reconciled.operators !== operators
  ) {
    setReconciled({ committed, operators });
    if (committed === undefined) {
      setOperatorId(operators[0]?.id ?? '');
    } else if (
      typeof committed.operator === 'string' &&
      operators.some((entry) => entry.id === committed.operator)
    ) {
      setOperatorId(committed.operator);
    }
  }

  const active = operators.find((entry) => entry.id === operatorId) ?? null;
  const arity: OperatorArity = active?.arity ?? 'set';

  const onOperatorChange = (next: string) => {
    setOperatorId(next);
    const nextArity =
      operators.find((entry) => entry.id === next)?.arity ?? 'set';
    if (nextArity === 'none') {
      filterSet.set({
        id: placement.spec_id,
        column: specColumn,
        kind: placement.kind,
        operator: next,
        label: field.label,
      });
      return;
    }
    const selection = Array.isArray(committed?.value) ? committed.value : [];
    if (selection.length === 0) {
      filterSet.remove(placement.spec_id);
      return;
    }
    filterSet.set({
      id: placement.spec_id,
      column: specColumn,
      kind: placement.kind,
      operator: next,
      value: selection,
      label: field.label,
    });
  };

  return (
    <>
      <OperatorSelect
        operators={operators}
        operatorId={operatorId}
        onChange={onOperatorChange}
        staticLabel={operatorLabel(operators, operatorId)}
        fieldLabel={field.label}
        testId={testId}
      />
      {arity === 'none' ? null : (
        <FacetMultiSelect
          specId={placement.spec_id}
          column={specColumn}
          table={field.facet_table ?? props.defaultFacetTable}
          arrayColumn={field.array_column}
          label={field.label}
          operator={operatorId}
          sort={field.array_column === true ? 'alpha' : 'count'}
          limit={field.array_column === true ? 100 : 50}
          enabled={props.enabled}
          testId={testId}
          filterSet={filterSet}
          page={props.page}
        />
      )}
    </>
  );
}

// ── Date-range value control ────────────────────────────────────────────────────

function DateRangeValue(props: {
  field: FilterFieldSpec;
  placement: FilterPlacementSpec;
  testId: string;
  filterSet: FilterSet;
}) {
  const { field, placement, testId, filterSet } = props;
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.spec_id);
  const bounds = Array.isArray(committed?.value)
    ? committed.value
    : [null, null];
  const start = typeof bounds[0] === 'string' ? bounds[0] : '';
  const end = typeof bounds[1] === 'string' ? bounds[1] : '';

  const setRange = (nextStart: string, nextEnd: string) => {
    const lo = nextStart === '' ? null : nextStart;
    const hi = nextEnd === '' ? null : nextEnd;
    if (lo === null && hi === null) {
      filterSet.remove(placement.spec_id);
      return;
    }
    filterSet.set({
      id: placement.spec_id,
      column: field.column,
      kind: placement.kind,
      value: [lo, hi],
      label: field.label,
    });
  };

  return (
    <>
      <OperatorSelect
        operators={[]}
        operatorId=""
        onChange={() => {}}
        staticLabel="in range"
        fieldLabel={field.label}
        testId={testId}
      />
      <div className="flex items-center gap-2" data-testid={`${testId}-value`}>
        <input
          type="date"
          data-testid={`${testId}-value-start`}
          aria-label={`${field.label} start`}
          className={`${inputClassName} min-w-0`}
          value={start}
          onChange={(event) => setRange(event.target.value, end)}
        />
        <span className="shrink-0 text-muted">–</span>
        <input
          type="date"
          data-testid={`${testId}-value-end`}
          aria-label={`${field.label} end`}
          className={`${inputClassName} min-w-0`}
          value={end}
          onChange={(event) => setRange(start, event.target.value)}
        />
      </div>
    </>
  );
}
