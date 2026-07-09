/**
 * The dynamic "Builder" authoring view over the page {@link filterSet} — the
 * full-power authoring surface (issue #180 / #181). The Classic view is a
 * curated subset of this, and must never limit it: every catalog field shares
 * its canonical spec id + kind with a Classic control, so setting a filter in
 * either view reflects losslessly in the other.
 *
 * The user picks a field from the catalog ({@link FILTER_CATALOG}) and confirms
 * with the "Add & edit" button (testid `filter-builder-confirm`); confirming
 * appends a compact filter BUTTON (one per canonical field id) into the builder
 * strip and opens its editor popover. Each button shows the field label plus a
 * short summary of the committed spec (operator + formatted value, or a HAVING
 * badge); an unconfigured field shows just the label in a dashed/muted style.
 *
 * Clicking a button toggles a popover editor anchored below it. The popover body
 * carries the same controls the old inline block did, stacked for a small panel:
 *
 *   placement → kind → operators (`kindRegistry[kind]?.operators`) → arity →
 *   value control(s) → `filterSet.set(spec)` (debounced text; immediate facets)
 *
 * The popover ALWAYS renders a placement control and an operator control, even
 * when only one option applies — they are then disabled (not hidden), so the
 * user always sees where a filter applies and how it compares. For list/facet
 * fields the operator is changeable (`in`/`not_in`/`is_empty`/`is_not_empty`, or
 * the array operators for an array column); for a kind with no operator axis
 * (interval date) the operator control is disabled with a static "in range"
 * label.
 *
 * Only one popover is open at a time (state lives in `FilterBuilder` as
 * `openPopoverFieldId`); it closes on an outside `mousedown` or Escape. Popover
 * content stays MOUNTED while its button exists and is hidden with Tailwind
 * `hidden` when closed — this preserves in-flight debounced scalar writes, the
 * ScalarValue/FacetValue mirror state, and the FacetMultiSelect facet client's
 * self-exclusion re-attach effect, all of which assume the control never
 * unmounts. Buttons hydrate from committed specs (with popovers CLOSED), so a
 * view switch or a shared link re-materializes a button for every field that
 * already holds a spec.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { kindRegistry } from '../page-context';
import { usePageFilterSet } from '../topology';
import { FILTER_CATALOG, facetOperatorIds } from '../filter-catalog';
import { useDebouncedRun } from '../filter-controls';
import { FacetMultiSelect } from './facet-multi-select';
import { usePopoverDismiss } from './use-popover-dismiss';
import type {
  FilterSet,
  FilterSpec,
  OperatorArity,
  OperatorDescriptor,
} from '@nozzleio/react-mosaic';
import type { CatalogField, CatalogPlacement } from '../filter-catalog';

const inputClassName =
  'h-9 rounded border border-slate-200 bg-white px-3 text-sm';
const selectClassName =
  'h-9 rounded border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-100 disabled:text-slate-500';
const labelClassName =
  'text-xs font-semibold tracking-wider text-slate-500 uppercase';

/**
 * Kinds that emit their own routing targets (having:/members:) and ignore
 * `spec.target`. A placement using one of these needs no explicit `spec.target`
 * — the chip badge resolves from the kind's published targets instead.
 */
const SELF_ROUTING_KINDS = new Set(['metric-threshold', 'min-domains']);

function isSelfRoutingKind(kind: string): boolean {
  return SELF_ROUTING_KINDS.has(kind);
}

/** True when the field's value control is one of the shared facet families. */
function isFacetField(field: CatalogField): boolean {
  return (
    field.valueKind === 'facet-multi' || field.valueKind === 'facet-multi-array'
  );
}

/**
 * The operators a placement's block offers. For facet fields the `condition`
 * kind advertises the full vocabulary, so we filter it to the membership /
 * emptiness (or array) subset the facet control can express — preserving the
 * kind's declared order. Non-facet fields use the kind's operators verbatim.
 */
function operatorsForBlock(
  field: CatalogField,
  placement: CatalogPlacement,
): ReadonlyArray<OperatorDescriptor> {
  const declared = kindRegistry[placement.kind]?.operators ?? [];
  if (!isFacetField(field)) {
    return declared;
  }
  // Order by the facet subset (so the value-bearing default — `in` /
  // `list_has_any` — is first), not the kind's declaration order (where the
  // emptiness operators lead). Missing descriptors are dropped defensively.
  return facetOperatorIds(field.valueKind)
    .map((id) => declared.find((entry) => entry.id === id))
    .filter((entry): entry is OperatorDescriptor => entry !== undefined);
}

/**
 * The operator a scalar block opens on. Text fields prefer `contains` (the
 * curated Classic default, so a Builder Phrase/Question stays representable in
 * the contains-only Classic input); everything else opens on the first
 * advertised operator. Falls back to the first operator when the preferred one
 * is absent.
 */
function defaultOperatorId(
  field: CatalogField,
  operators: ReadonlyArray<OperatorDescriptor>,
): string {
  if (
    field.valueKind === 'text' &&
    operators.some((entry) => entry.id === 'contains')
  ) {
    return 'contains';
  }
  return operators[0]?.id ?? '';
}

// ── Committed-spec summary (drives the button label) ─────────────────────────

/**
 * A placement whose committed filter lands in an aggregate HAVING (+ membership)
 * clause rather than a row-level WHERE. This mirrors the active-filter-bar's
 * badge logic: an explicit `having:` target, OR a self-routing kind
 * (metric-threshold / min-domains) that emits its own having:/members: clauses
 * — so the button badge and the chip badge stay consistent.
 */
function isHavingPlacement(placement: CatalogPlacement): boolean {
  return (
    placement.target.startsWith('having:') || isSelfRoutingKind(placement.kind)
  );
}

/** Format a committed spec's value into a compact, human-readable fragment. */
function formatSummaryValue(field: CatalogField, spec: FilterSpec): string {
  const { value, valueTo } = spec;
  if (field.valueKind === 'date-range') {
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
  if (field.valueKind === 'text') {
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
  field: CatalogField,
  specs: ReadonlyArray<FilterSpec>,
): FieldSummary {
  const placement = field.placements.find((entry) =>
    specs.some((spec) => spec.id === entry.specId),
  );
  if (placement === undefined) {
    return { configured: false, badge: null, text: '' };
  }
  const spec = specs.find((entry) => entry.id === placement.specId);
  if (spec === undefined) {
    return { configured: false, badge: null, text: '' };
  }
  const operators = operatorsForBlock(field, placement);
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

/** Trigger-button classes: cyan accent when configured, dashed when not. */
function filterButtonClassName(configured: boolean, open: boolean): string {
  const base =
    'flex h-9 max-w-full items-center gap-1.5 rounded border px-3 text-sm';
  const state = configured
    ? 'border-cyan-300 bg-cyan-50 text-slate-800'
    : 'border-dashed border-slate-300 bg-white text-slate-500 hover:text-slate-700';
  const openState = open ? 'ring-2 ring-cyan-500' : '';
  return `${base} ${state} ${openState}`;
}

const confirmButtonClassName =
  'h-9 rounded border border-cyan-600 bg-cyan-50 px-3 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400';

// ── The builder ──────────────────────────────────────────────────────────────

export function FilterBuilder() {
  // The managed list of open fields, one button per canonical field id.
  // Hydrating from the current specs keeps the builder in sync after a view
  // switch: any field that already holds a spec (set by the classic view, a
  // chip, or a shared link) materializes a button automatically (popover
  // closed).
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  const [openFieldIds, setOpenFieldIds] = useState<Array<string>>(() =>
    hydrateOpenFields(filterSet, []),
  );
  // The field chosen in the add `<select>` but not yet confirmed. Confirming
  // (`filter-builder-confirm`) materializes its button and opens its popover.
  const [pendingFieldId, setPendingFieldId] = useState('');
  // The single field whose popover is open (null = all closed).
  const [openPopoverFieldId, setOpenPopoverFieldId] = useState<string | null>(
    null,
  );

  // Adopt fields that gained a spec elsewhere (classic view / shared link),
  // without dropping buttons the user opened but has not yet filled. This never
  // opens a popover, so a hydrated field surfaces as a closed button.
  useEffect(() => {
    setOpenFieldIds((prev) => hydrateOpenFields(filterSet, prev));
  }, [filterSet, specs]);

  const openFields = useMemo(
    () =>
      openFieldIds
        .map((id) => FILTER_CATALOG.find((field) => field.id === id))
        .filter((field): field is CatalogField => field !== undefined),
    [openFieldIds],
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

  const removeField = (field: CatalogField) => {
    // Clearing a field removes every spec its placements might own so no stale
    // spec lingers on a target the button is no longer showing.
    for (const placement of field.placements) {
      filterSet.remove(placement.specId);
    }
    setOpenFieldIds((prev) => prev.filter((id) => id !== field.id));
    setOpenPopoverFieldId((prev) => (prev === field.id ? null : prev));
  };

  const togglePopover = (fieldId: string) => {
    setOpenPopoverFieldId((prev) => (prev === fieldId ? null : fieldId));
  };

  const available = FILTER_CATALOG.filter(
    (field) => !openFieldIds.includes(field.id),
  );

  return (
    <div className="flex w-full flex-col gap-3" data-testid="filter-builder">
      <div className="flex flex-wrap items-center gap-2">
        <span className={labelClassName}>Build a filter</span>
        <select
          data-testid="filter-builder-add-field"
          aria-label="Add filter field"
          className={selectClassName}
          value={pendingFieldId}
          onChange={(event) => setPendingFieldId(event.target.value)}
        >
          <option value="">Add field…</option>
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
            open={openPopoverFieldId === field.id}
            onToggle={() => togglePopover(field.id)}
            onClose={closePopover}
            onRemove={() => removeField(field)}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Pick a field and choose “Add &amp; edit”, then set where it applies
        (row-level WHERE vs aggregate HAVING), how it compares, and its value.
        These edit the same page filters as the Classic view.
      </p>
    </div>
  );
}

/**
 * Fields to keep open: any currently open, plus any that now hold a spec.
 * Returns `prev` unchanged (referentially) when nothing was added, so the
 * hydrate effect does not force a needless re-render on every spec change.
 */
function hydrateOpenFields(
  filterSet: FilterSet,
  prev: Array<string>,
): Array<string> {
  const state = filterSet.store.state;
  const added: Array<string> = [];
  for (const field of FILTER_CATALOG) {
    if (prev.includes(field.id)) {
      continue;
    }
    const hasSpec = field.placements.some((placement) =>
      state.specs.some((spec) => spec.id === placement.specId),
    );
    if (hasSpec) {
      added.push(field.id);
    }
  }
  return added.length === 0 ? prev : [...prev, ...added];
}

// ── One filter button + its popover editor ───────────────────────────────────

interface FilterButtonProps {
  field: CatalogField;
  /** Whether this field's popover is the one currently open. */
  open: boolean;
  /** Toggle this field's popover (open if closed, close if open). */
  onToggle: () => void;
  /** Close this field's popover (outside mousedown / Escape dismissal). */
  onClose: () => void;
  onRemove: () => void;
}

function FilterButton(props: FilterButtonProps) {
  const { field, open } = props;
  const filterSet = usePageFilterSet();
  const testId = `filter-block-${field.id}`;
  const { specs } = useFilterSetState(filterSet);

  // Light-dismiss on an outside mousedown or Escape. A mousedown on ANOTHER
  // field's button lands outside this root, so it dismisses this popover first
  // and that button's click then opens its own — switching still works.
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(rootRef, open, props.onClose);

  // Which placement is active. Hydrate from whichever placement currently holds
  // a spec, so a view switch or shared link reopens the button on the right one.
  const initialPlacement = useMemo(() => {
    const withSpec = field.placements.findIndex((placement) =>
      filterSet.store.state.specs.some((spec) => spec.id === placement.specId),
    );
    return withSpec === -1 ? 0 : withSpec;
  }, [field.placements]);
  const [placementIndex, setPlacementIndex] = useState(initialPlacement);
  const placement = field.placements[placementIndex] ?? field.placements[0]!;

  const operators = useMemo(
    () => operatorsForBlock(field, placement),
    [field, placement],
  );

  const specColumn = placement.specColumn ?? field.column;
  const singlePlacement = field.placements.length === 1;

  // Button summary reflects the COMMITTED set, not the popover's live placement
  // selection — so it stays correct while the popover is closed.
  const summary = useMemo(() => summarizeField(field, specs), [field, specs]);

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
        <span className="shrink-0 font-semibold">{field.label}</span>
        {summary.badge !== null ? (
          <span className="shrink-0 rounded-sm bg-orange-100 px-1 text-[9px] font-bold tracking-wider text-orange-600">
            {summary.badge}
          </span>
        ) : null}
        {summary.text !== '' ? (
          <span className="truncate text-slate-500">{summary.text}</span>
        ) : null}
        <span aria-hidden className="shrink-0 text-slate-400">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Popover content stays MOUNTED while the button exists (hidden via
          Tailwind `hidden` when closed) so in-flight debounced writes, the value
          controls' draft/mirror state, and the facet client's self-exclusion
          re-attach effect all survive an open/close. z-30 clears the sticky
          header and the summary-table grid below. */}
      <div
        data-testid={`filter-popover-${field.id}`}
        role="dialog"
        aria-label={`${field.label} filter`}
        className={`absolute top-full left-0 z-30 mt-1 flex min-w-[240px] flex-col gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {field.label}
          </span>
          <button
            type="button"
            data-testid={`${testId}-remove`}
            aria-label={`Remove ${field.label} filter`}
            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-red-600"
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
              // Placements route to different spec ids; drop the old spec so it
              // does not linger when the button switches kind/target.
              if (prevPlacement !== undefined) {
                filterSet.remove(prevPlacement.specId);
              }
              setPlacementIndex(nextIndex);
            }}
          >
            {field.placements.map((entry, index) => (
              <option key={entry.specId} value={String(index)}>
                {entry.label}
              </option>
            ))}
          </select>

          {/*
            Key every value control by the active placement's spec id so switching
            placement REMOUNTS it. This is load-bearing for ScalarValue: its
            debounced publish captures the placement's buildSpec/specId, and a
            placement switch removes the prior spec — remounting runs the outgoing
            control's unmount cleanup (which cancels the debounce), so a pending
            keystroke can no longer republish the just-removed spec.
          */}
          {isFacetField(field) ? (
            <FacetValue
              key={placement.specId}
              field={field}
              placement={placement}
              specColumn={specColumn}
              operators={operators}
              testId={testId}
            />
          ) : field.valueKind === 'date-range' ? (
            <DateRangeValue
              key={placement.specId}
              field={field}
              placement={placement}
              testId={testId}
            />
          ) : (
            <ScalarValue
              key={placement.specId}
              field={field}
              placement={placement}
              specColumn={specColumn}
              operators={operators}
              testId={testId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The operator control shared by every value editor. Always rendered; when the
 * kind advertises no operators (interval date), it is disabled with a static
 * label. When it advertises exactly one, it is disabled showing that operator.
 */
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

// ── Scalar (text / number) value control ──────────────────────────────────────

function ScalarValue(props: {
  field: CatalogField;
  placement: CatalogPlacement;
  specColumn: string;
  operators: ReadonlyArray<OperatorDescriptor>;
  testId: string;
}) {
  const { field, placement, specColumn, operators, testId } = props;
  const filterSet = usePageFilterSet();

  // The committed spec for this placement (read back so external edits, chip
  // removal, and hydration reflect into the controls).
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.specId);

  const [operatorId, setOperatorId] = useState<string>(() =>
    defaultOperatorId(field, operators),
  );
  const [value, setValue] = useState('');
  const [valueTo, setValueTo] = useState('');
  const debounce = useDebouncedRun(300);

  // True while a locally-initiated debounced publish is armed but not yet
  // committed. It lets the committed-mirror effect tell "the user is mid-edit
  // (committed is momentarily stale)" from "committed disappeared externally
  // (chip ✕, Clear All, a cross-view edit)" — only the latter clears the input.
  const pendingWriteRef = useRef(false);
  const committedExists = committed !== undefined;

  // Reset the operator to a valid one when the placement's kind changes.
  useEffect(() => {
    setOperatorId((prev) =>
      operators.some((entry) => entry.id === prev)
        ? prev
        : defaultOperatorId(field, operators),
    );
  }, [field, operators]);

  // Mirror committed spec → controls. Runs on hydration/mount (spec present) and
  // whenever the committed spec appears or disappears. Guarded by the pending
  // ref so an in-progress debounced edit (committed briefly stale) is not fought.
  useEffect(() => {
    if (pendingWriteRef.current) {
      return;
    }
    const current = filterSet.store.state.specs.find(
      (spec) => spec.id === placement.specId,
    );
    if (current === undefined) {
      // External removal (chip ✕, Clear All, cross-view edit): drop stale local
      // state and cancel any armed publish so a later operator change cannot
      // resurrect the deleted filter from stale text.
      debounce.cancel();
      setValue('');
      setValueTo('');
      setOperatorId(defaultOperatorId(field, operators));
      return;
    }
    if (
      typeof current.operator === 'string' &&
      operators.some((entry) => entry.id === current.operator)
    ) {
      setOperatorId(current.operator);
    }
    setValue(current.value === undefined ? '' : String(current.value));
    setValueTo(current.valueTo === undefined ? '' : String(current.valueTo));
    // Reconcile on spec-existence transitions and placement changes; `operators`
    // and `field` feed only the default-operator fallback on removal.
  }, [placement.specId, committedExists]);

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
      id: placement.specId,
      column: specColumn,
      kind: placement.kind,
      operator: nextOperatorId,
      label: field.label,
    };
    // Only carry an explicit `target` when the kind routes BY it. WHERE
    // placements use the default 'where' target (omit it). Self-routing kinds
    // (metric-threshold, min-domains) emit their own having:/members: clauses
    // and ignore `spec.target` entirely, and the chip badge now resolves from
    // the kind's published targets — so a decorative target is dead weight. A
    // routed kind (e.g. `condition`) landing on a non-where target still needs
    // it; that is load-bearing and preserved.
    if (placement.target !== 'where' && !isSelfRoutingKind(placement.kind)) {
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
      pendingWriteRef.current = false;
      const spec = buildSpec(nextOperatorId, nextValue, nextValueTo);
      if (spec === null) {
        filterSet.remove(placement.specId);
        return;
      }
      filterSet.set(spec);
    };
    if (immediate) {
      debounce.cancel();
      pendingWriteRef.current = false;
      run();
      return;
    }
    pendingWriteRef.current = true;
    debounce.run(run);
  };

  return (
    <>
      <OperatorSelect
        operators={operators}
        operatorId={operatorId}
        onChange={(next) => {
          setOperatorId(next);
          // Switching to a none-arity operator commits immediately; otherwise
          // republish with the current values (or remove if now incomplete).
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
          type={field.valueKind === 'number' ? 'number' : 'text'}
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
          type={field.valueKind === 'number' ? 'number' : 'text'}
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

/** The label shown for the current operator (static-control fallback). */
function operatorLabel(
  operators: ReadonlyArray<OperatorDescriptor>,
  operatorId: string,
): string {
  const match = operators.find((entry) => entry.id === operatorId);
  return match?.label ?? operatorId;
}

/** Coerce a raw text entry to the field's value type (numbers for number fields). */
function coerce(field: CatalogField, raw: string): string | number {
  if (field.valueKind === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

// ── Facet multi-select value control ──────────────────────────────────────────

/**
 * A facet field's block: a changeable operator (the membership / array subset)
 * plus the shared {@link FacetMultiSelect}. Emptiness operators
 * (`is_empty`/`is_not_empty`, arity `none`) carry no value list, so the option
 * list is hidden and the spec is written directly here.
 */
function FacetValue(props: {
  field: CatalogField;
  placement: CatalogPlacement;
  specColumn: string;
  operators: ReadonlyArray<OperatorDescriptor>;
  testId: string;
}) {
  const { field, placement, specColumn, operators, testId } = props;
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.specId);

  const [operatorId, setOperatorId] = useState<string>(
    () => committed?.operator ?? operators[0]?.id ?? '',
  );

  // Mirror the committed operator (hydration, external edits). After an external
  // removal (chip ✕, Clear All) the spec is gone, so reset the displayed
  // operator to the default rather than leaving a stale one.
  useEffect(() => {
    if (committed === undefined) {
      setOperatorId(operators[0]?.id ?? '');
      return;
    }
    if (
      typeof committed.operator === 'string' &&
      operators.some((entry) => entry.id === committed.operator)
    ) {
      setOperatorId(committed.operator);
    }
  }, [committed, operators]);

  const active = operators.find((entry) => entry.id === operatorId) ?? null;
  const arity: OperatorArity = active?.arity ?? 'set';

  const onOperatorChange = (next: string) => {
    setOperatorId(next);
    const nextArity =
      operators.find((entry) => entry.id === next)?.arity ?? 'set';
    if (nextArity === 'none') {
      // Emptiness operator: write a valueless spec immediately.
      filterSet.set({
        id: placement.specId,
        column: specColumn,
        kind: placement.kind,
        operator: next,
        label: field.label,
      });
      return;
    }
    // A value-bearing operator: re-key the existing selection (if any) under it,
    // or drop the spec until the user picks values.
    const selection = Array.isArray(committed?.value) ? committed.value : [];
    if (selection.length === 0) {
      filterSet.remove(placement.specId);
      return;
    }
    filterSet.set({
      id: placement.specId,
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
        <FacetOptions
          field={field}
          specColumn={specColumn}
          specId={placement.specId}
          operator={operatorId}
          testId={testId}
        />
      )}
    </>
  );
}

/**
 * Wraps the shared {@link FacetMultiSelect}, but for the array-column field
 * enumerates the array's element counts (via `useMosaicFacet`'s `arrayColumn`).
 * The shared component owns the spec read/write.
 */
function FacetOptions(props: {
  field: CatalogField;
  specColumn: string;
  specId: string;
  operator: string;
  testId: string;
}) {
  const { field } = props;
  return (
    <FacetMultiSelect
      specId={props.specId}
      column={props.specColumn}
      arrayColumn={field.arrayColumn}
      label={field.label}
      operator={props.operator}
      sort={field.arrayColumn ? 'alpha' : 'count'}
      limit={field.arrayColumn ? 100 : 50}
      enabled
      testId={props.testId}
    />
  );
}

// ── Date-range value control ───────────────────────────────────────────────────

/**
 * An interval date field. The `interval` kind has no operator axis, so the
 * operator control renders disabled with a static "in range" label; the value
 * is two date inputs bound to the interval `value` tuple.
 */
function DateRangeValue(props: {
  field: CatalogField;
  placement: CatalogPlacement;
  testId: string;
}) {
  const { field, placement, testId } = props;
  const filterSet = usePageFilterSet();
  const { specs } = useFilterSetState(filterSet);
  const committed = specs.find((spec) => spec.id === placement.specId);
  const bounds = Array.isArray(committed?.value)
    ? committed.value
    : [null, null];
  const start = typeof bounds[0] === 'string' ? bounds[0] : '';
  const end = typeof bounds[1] === 'string' ? bounds[1] : '';

  const setRange = (nextStart: string, nextEnd: string) => {
    const lo = nextStart === '' ? null : nextStart;
    const hi = nextEnd === '' ? null : nextEnd;
    if (lo === null && hi === null) {
      filterSet.remove(placement.specId);
      return;
    }
    filterSet.set({
      id: placement.specId,
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
        <span className="shrink-0 text-slate-400">–</span>
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
