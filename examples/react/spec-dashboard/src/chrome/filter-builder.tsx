/**
 * The spec-driven filter builder — the only filter authoring surface on the
 * page, driven from `spec.filters.fields`.
 *
 * The user picks a field from the spec's field list and confirms with the
 * "Add & edit" button (testid `filter-builder-confirm`); confirming appends a
 * compact filter BUTTON (one per field id) into the builder strip and opens its
 * editor popover. Each button shows the field label plus a short summary of the
 * committed spec (operator + formatted value, or a HAVING badge); an
 * unconfigured field shows just the label in a dashed/muted style.
 *
 * Clicking a button toggles a popover editor anchored below it. The popover body
 * carries the same controls the old inline block did, stacked for a small panel:
 *
 *   placement → kind → operators (`kindRegistry[kind].operators`) → arity →
 *   value control (by `valueKind`) → `filterSet.set(spec)` (debounced text /
 *   immediate facets), writing the placement's canonical `specId` into the
 *   primary FilterSet, plus a "Remove filter" action.
 *
 * Only one popover is open at a time (state lives in `FilterBuilder` as
 * `openPopoverFieldId`); it closes on an outside `mousedown` or Escape. Popover
 * content stays MOUNTED while its button exists and is hidden with `display:none`
 * when closed — this preserves in-flight debounced scalar writes, the
 * ScalarValue/FacetValue draft + mirror state, and the FacetMultiSelect facet
 * client registration / self-exclusion re-attach effect, all of which assume the
 * control never unmounts.
 *
 * Buttons hydrate from committed specs, so a re-render or a spec re-apply
 * re-materializes a button (popover closed) for every field that already holds a
 * spec on the current set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { FacetMultiSelect } from './facet-multi-select';
import { usePopoverDismiss } from './use-popover-dismiss';
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

// ── Committed-spec summary (drives the button label) ─────────────────────────

/** A placement whose routing target lands in a HAVING/membership clause. */
function isHavingPlacement(placement: FilterPlacementSpec): boolean {
  return (
    placement.target.startsWith('having:') ||
    placement.target.startsWith('members:')
  );
}

/** Format a committed spec's value into a compact, human-readable fragment. */
function formatSummaryValue(field: FilterFieldSpec, spec: FilterSpec): string {
  const { value, valueTo } = spec;
  if (field.value_kind === 'date') {
    if (!Array.isArray(value)) {
      return '';
    }
    const lo = typeof value[0] === 'string' && value[0] !== '' ? value[0] : '…';
    const hi = typeof value[1] === 'string' && value[1] !== '' ? value[1] : '…';
    return `${lo} – ${hi}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }
    if (value.length === 1) {
      return String(value[0]);
    }
    return `${value.length} selected`;
  }
  if (value === undefined) {
    return '';
  }
  if (valueTo !== undefined) {
    return `${String(value)} – ${String(valueTo)}`;
  }
  if (field.value_kind === 'text') {
    return `"${String(value)}"`;
  }
  return String(value);
}

interface FieldSummary {
  /** True once any placement holds a committed spec (drives the button style). */
  configured: boolean;
  /** Short placement badge (`HAVING`) or null for row-level WHERE placements. */
  badge: string | null;
  /** Operator + formatted value (empty when there is nothing to show). */
  text: string;
}

/**
 * Summarize a field from the COMMITTED set: find whichever placement currently
 * holds a spec (independent of the popover's live placement selection) and
 * render its operator + value. An unconfigured field returns `configured:false`.
 */
function summarizeField(
  field: FilterFieldSpec,
  specs: ReadonlyArray<FilterSpec>,
  kindRegistry: KindRegistry,
): FieldSummary {
  const placement = field.placements.find((entry) =>
    specs.some((spec) => spec.id === entry.spec_id),
  );
  if (placement === undefined) {
    return { configured: false, badge: null, text: '' };
  }
  const spec = specs.find((entry) => entry.id === placement.spec_id);
  if (spec === undefined) {
    return { configured: false, badge: null, text: '' };
  }
  const operators = operatorsForBlock(field, placement, kindRegistry);
  const opLabel =
    typeof spec.operator === 'string'
      ? operatorLabel(operators, spec.operator)
      : '';
  const valueText = formatSummaryValue(field, spec);
  const text = [opLabel, valueText].filter((part) => part !== '').join(' ');
  return {
    configured: true,
    badge: isHavingPlacement(placement) ? 'HAVING' : null,
    text,
  };
}

/** Trigger-button classes: active accent when configured, dashed when not. */
function filterButtonClassName(configured: boolean, open: boolean): string {
  const base =
    'flex h-7 max-w-full items-center gap-1.5 rounded-gf border px-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue';
  const state = configured
    ? 'border-gf-blue/40 bg-gf-blue/10 text-ink'
    : 'border-dashed border-line bg-field text-muted hover:text-ink';
  const openState = open ? 'ring-2 ring-gf-blue' : '';
  return `${base} ${state} ${openState}`;
}

const confirmButtonClassName =
  'h-7 rounded-gf border border-gf-blue/50 bg-gf-blue/10 px-2 text-xs font-medium text-ink hover:bg-gf-blue/20 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue';

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
  // The field chosen in the add `<select>` but not yet confirmed. Confirming
  // (`filter-builder-confirm`) materializes its button and opens its popover.
  const [pendingFieldId, setPendingFieldId] = useState('');
  // The single field whose popover is open (null = all closed).
  const [openPopoverFieldId, setOpenPopoverFieldId] = useState<string | null>(
    null,
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

  // Each open button dismisses its own popover via `usePopoverDismiss`; this
  // shared close handler is stable so the per-button dismiss effects do not
  // re-subscribe every render.
  const closePopover = useCallback(() => {
    setOpenPopoverFieldId(null);
  }, []);

  const confirmAdd = () => {
    if (pendingFieldId === '') {
      return;
    }
    const fieldId = pendingFieldId;
    setOpenFieldIds((prev) =>
      prev.includes(fieldId) ? prev : [...prev, fieldId],
    );
    setPendingFieldId('');
    setOpenPopoverFieldId(fieldId);
  };

  const removeField = (field: FilterFieldSpec) => {
    for (const placement of field.placements) {
      filterSet.remove(placement.spec_id);
    }
    setOpenFieldIds((prev) => prev.filter((id) => id !== field.id));
    setOpenPopoverFieldId((prev) => (prev === field.id ? null : prev));
  };

  const togglePopover = (fieldId: string) => {
    setOpenPopoverFieldId((prev) => (prev === fieldId ? null : fieldId));
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
          value={pendingFieldId}
          onChange={(event) => setPendingFieldId(event.target.value)}
        >
          <option value="">+ Add field…</option>
          {available.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="filter-builder-confirm"
          className={confirmButtonClassName}
          disabled={pendingFieldId === ''}
          onClick={confirmAdd}
        >
          Add &amp; edit
        </button>

        {openFields.map((field) => (
          <FilterButton
            key={field.id}
            field={field}
            filterSet={filterSet}
            kindRegistry={props.kindRegistry}
            selfRoutingKinds={props.selfRoutingKinds}
            page={props.page}
            defaultFacetTable={props.defaultFacetTable}
            enabled={props.enabled}
            open={openPopoverFieldId === field.id}
            onToggle={() => togglePopover(field.id)}
            onClose={closePopover}
            onRemove={() => removeField(field)}
          />
        ))}
      </div>

      <p className="text-[11px] text-faint">
        Pick a field and choose “Add &amp; edit”, then set where it applies
        (row-level WHERE vs aggregate HAVING), how it compares, and its value.
      </p>
    </div>
  );
}

// ── One filter button + its popover editor ───────────────────────────────────

interface FilterButtonProps {
  field: FilterFieldSpec;
  filterSet: FilterSet;
  kindRegistry: KindRegistry;
  selfRoutingKinds: ReadonlySet<string>;
  page: Selection | undefined;
  defaultFacetTable: string;
  enabled: boolean;
  /** Whether this field's popover is the one currently open. */
  open: boolean;
  /** Toggle this field's popover (open if closed, close if open). */
  onToggle: () => void;
  /** Close this field's popover (outside mousedown / Escape dismissal). */
  onClose: () => void;
  onRemove: () => void;
}

function FilterButton(props: FilterButtonProps) {
  const { field, filterSet, open } = props;
  const testId = `filter-block-${field.id}`;
  const { specs } = useFilterSetState(filterSet);

  // Light-dismiss on an outside mousedown or Escape. A mousedown on ANOTHER
  // field's button lands outside this root, so it dismisses this popover first
  // and that button's click then opens its own — switching still works.
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(rootRef, open, props.onClose);

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

  // Button summary reflects the COMMITTED set, not the popover's live placement
  // selection — so it stays correct while the popover is closed.
  const summary = useMemo(
    () => summarizeField(field, specs, props.kindRegistry),
    [field, specs, props.kindRegistry],
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-testid={`filter-button-${field.id}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={filterButtonClassName(summary.configured, open)}
        onClick={props.onToggle}
      >
        <span className="shrink-0 font-medium">{field.label}</span>
        {summary.badge !== null ? (
          <span className="shrink-0 rounded-[1px] bg-gf-orange/20 px-1 text-[9px] font-bold tracking-wider text-gf-orange">
            {summary.badge}
          </span>
        ) : null}
        {summary.text !== '' ? (
          <span className="truncate text-muted">{summary.text}</span>
        ) : null}
        <span aria-hidden className="shrink-0 text-faint">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Popover content stays MOUNTED while the button exists (hidden via
          `display:none` when closed) so in-flight debounced writes, the value
          controls' draft/mirror state, and the facet client's self-exclusion
          re-attach effect all survive an open/close. z-30 clears the sticky
          header (z-20) and the panel grid. */}
      <div
        data-testid={`filter-popover-${field.id}`}
        role="dialog"
        aria-label={`${field.label} filter`}
        className={`absolute top-full left-0 z-30 mt-1 flex min-w-[240px] flex-col gap-2 rounded-gf border border-line bg-panel p-3 shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink">{field.label}</span>
          <button
            type="button"
            data-testid={`${testId}-remove`}
            aria-label={`Remove ${field.label} filter`}
            className="rounded-gf px-1.5 py-0.5 text-[11px] text-faint hover:bg-hover hover:text-gf-red focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
            onClick={props.onRemove}
          >
            Remove filter
          </button>
        </div>

        <div className="flex flex-col gap-2 [&_input]:w-full [&_select]:w-full">
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
        </div>
      </div>
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
