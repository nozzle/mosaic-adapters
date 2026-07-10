/**
 * Spec-declared URL persistence for the dashboard's page {@link FilterSet}.
 *
 * Where the reference persister (`examples/react/nozzle-paa/src/filter-url.ts`)
 * hand-writes its codec table, THIS registry is DERIVED from the compiled spec:
 * every spec-id-declaring site in the YAML — filter `placements`, selection-table
 * `publish` / `metric_threshold`, and data-table `bridge_columns` — contributes a
 * codec keyed by its spec id. Each codec stores the STATIC parts of a
 * {@link FilterSpec} (column, kind, fixed operator, label, routing target); the
 * URL param carries only the DYNAMIC parts (the value, and the operator where it
 * varies). On read the static parts always come from the registry, so a shared
 * link can never redirect a filter onto an undeclared column/kind/target.
 *
 * ## URL value grammar (reused verbatim from the nozzle-paa dialect)
 *
 * - The DEFAULT operator of a family encodes bare; a NON-default operator rides
 *   the `op~<operator>~<value-tail>` envelope, and a valueless operator
 *   (`is_empty` …) is `op~is_empty~`. The operator is validated against the
 *   kind's vocabulary on read; an unknown one falls back to the bare default.
 * - Lists (facets, points): each element `%`-encoded, comma-joined.
 * - text: the bare string (default `contains`).
 * - date/interval: ISO `lo..hi` (either bound may be empty; both-empty invalid).
 * - numeric condition: `op:value`, `between` as `op:lo:hi`, valueless as `op:`.
 * - metric threshold: `op:value`.
 *
 * Codec behavior is keyed generically by `value_kind` / `kind` — never by any
 * domain-specific spec id. Unknown params, unknown spec ids, and malformed
 * values are skipped defensively (the FilterSet re-validates on hydration too).
 *
 * ## Ownership + defaults
 *
 * With a `param_prefix` the read side owns EVERY param under that prefix
 * (`<prefix>.<spec_id>`); without one it owns exactly the params whose names
 * match a derivable spec id. When no owned param is present, the spec-declared
 * defaults (the central `filters.defaults` list) hydrate; any owned param
 * present wins wholesale (defaults are NOT merged in). A FilterSet clear-all
 * removes every owned param, so a reload restores the declared defaults.
 *
 * ## Injected router I/O (no imperative URL access)
 *
 * The persister never touches the router core. Its `search` snapshot and
 * `navigateSearch` setter are INJECTED (see {@link PersisterIo}) by a component
 * that called the router hooks. `read` runs once, synchronously, during topology
 * construction in the same render that captured the snapshot, so the injected
 * snapshot is the current URL at read time. `write` never enumerates the live
 * URL: it patches the FULL derived registry — every spec id maps to its encoded
 * value (active) or `null` (absent) — which deletes stale owned params and
 * leaves foreign ones alone, all under the router's own no-op-navigation guard.
 */
import type { NavigateSearchOptions, Search, SearchPatch } from '@/router';
import type {
  FilterKind,
  FilterSpec,
  OperatorDescriptor,
  Persister,
} from '@nozzleio/react-mosaic';
import type {
  BridgeColumnSpec,
  DashboardSpec,
  FilterDefaultSpec,
  FilterFieldSpec,
  FilterPlacementSpec,
  TopologySpec,
} from './schema';

/** The reserved app param a bare (prefix-less) persister must never collide with. */
const RESERVED_SPEC_PARAM = 'spec';

/**
 * The operator subsets a facet field exposes, mirroring the filter builder's
 * `FACET_SCALAR_OPERATORS` / `FACET_ARRAY_OPERATORS`. A builder-authored facet
 * spec must round-trip, so the codec offers exactly the same vocabulary. The
 * first entry is the value-bearing default (`in` / `list_has_any`).
 */
const FACET_SCALAR_OPERATORS = ['in', 'not_in', 'is_empty', 'is_not_empty'];
const FACET_ARRAY_OPERATORS = ['list_has_any', 'list_has_all', 'excludes_all'];

// ── The codec contract ───────────────────────────────────────────────────────

/**
 * The static parts of a spec plus a per-family value codec. The URL param
 * carries only what `encode`/`decode` move; everything else is reconstructed
 * from these fields on read.
 */
interface SpecCodec {
  column: string;
  kind: string;
  /** Fixed operator when the kind pins one (e.g. the facet default `in`). */
  operator?: string;
  label: string;
  /** Fixed routing target when non-default (self-routing kinds omit it). */
  target?: string;
  /** Serialize a spec's dynamic parts, or `null` when inactive/empty. */
  encode: (spec: FilterSpec) => string | null;
  /** Rebuild a full spec from the param value, or `null` when malformed. */
  decode: (id: string, raw: string) => FilterSpec | null;
}

/** The derived spec-id → codec registry, plus the ordered list of ids. */
export interface FilterUrlRegistry {
  get: (id: string) => SpecCodec | undefined;
  readonly ids: ReadonlyArray<string>;
}

/** Resolved URL-persistence config for the primary filter-set entry. */
export interface FilterPersistConfig {
  /** The filter-set entry name that declared `persist`. */
  entryName: string;
  /** The `param_prefix`, or `undefined` for bare param names. */
  prefix: string | undefined;
}

// ── Operator-envelope + small parse helpers (nozzle-paa dialect) ─────────────

const OPERATOR_ENVELOPE = /^op~([a-z_]+)~/;

function encodeOperatorEnvelope(operator: string, valueTail: string): string {
  return `op~${operator}~${valueTail}`;
}

function parseOperatorEnvelope(raw: string): {
  operator: string | null;
  valueTail: string;
} {
  const match = OPERATOR_ENVELOPE.exec(raw);
  if (match === null) {
    return { operator: null, valueTail: raw };
  }
  return { operator: match[1] ?? null, valueTail: raw.slice(match[0].length) };
}

/** Splits a comma-joined, per-element URL-encoded list, dropping empties. */
function decodeList(raw: string): Array<string> {
  if (raw.length === 0) {
    return [];
  }
  const values: Array<string> = [];
  for (const part of raw.split(',')) {
    if (part.length === 0) {
      continue;
    }
    try {
      values.push(decodeURIComponent(part));
    } catch {
      // A malformed %-escape: skip that element, keep the rest.
    }
  }
  return values;
}

/** Per-element URL-encodes a scalar list into the comma-joined param form. */
function encodeList(values: ReadonlyArray<unknown>): string {
  return values.map((value) => encodeURIComponent(String(value))).join(',');
}

/** Parses an `operator:value` param (e.g. `gt:5000`), or `null`. */
function parseOperatorValue(
  raw: string,
): { operator: string; value: string } | null {
  const separator = raw.indexOf(':');
  if (separator < 0) {
    return null;
  }
  return {
    operator: raw.slice(0, separator),
    value: raw.slice(separator + 1),
  };
}

/** The operator ids of a kind whose arity is `none` (valueless). */
function valuelessOperatorIds(
  operators: ReadonlyArray<OperatorDescriptor>,
): Set<string> {
  const set = new Set<string>();
  for (const operator of operators) {
    if (operator.arity === 'none') {
      set.add(operator.id);
    }
  }
  return set;
}

/** A finite number parsed from a trimmed string, or `null`. */
function toFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Per-family codec factories ───────────────────────────────────────────────

/**
 * A `text` condition spec. The default operator (`contains` when offered, else
 * the first) encodes as the bare raw string; any other operator rides the
 * envelope, and a valueless operator (`is_empty` …) is `op~is_empty~`. A legacy
 * bare value always decodes to the default operator.
 */
function textConditionCodec(config: {
  column: string;
  kind: string;
  label: string;
  target: string | undefined;
  operators: ReadonlyArray<OperatorDescriptor>;
}): SpecCodec {
  const allowed = new Set(config.operators.map((entry) => entry.id));
  const valueless = valuelessOperatorIds(config.operators);
  const defaultOperator = allowed.has('contains')
    ? 'contains'
    : (config.operators[0]?.id ?? 'contains');

  const build = (
    id: string,
    operator: string,
    value: string | undefined,
  ): FilterSpec => {
    const spec: FilterSpec = {
      id,
      column: config.column,
      kind: config.kind,
      operator,
      label: config.label,
    };
    if (value !== undefined) {
      spec.value = value;
    }
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  };

  return {
    column: config.column,
    kind: config.kind,
    operator: defaultOperator,
    label: config.label,
    target: config.target,
    encode: (spec) => {
      const operator =
        typeof spec.operator === 'string' ? spec.operator : defaultOperator;
      if (!allowed.has(operator)) {
        return null;
      }
      if (valueless.has(operator)) {
        return encodeOperatorEnvelope(operator, '');
      }
      if (typeof spec.value !== 'string' || spec.value.length === 0) {
        return null;
      }
      if (operator === defaultOperator) {
        return spec.value;
      }
      return encodeOperatorEnvelope(operator, spec.value);
    },
    decode: (id, raw) => {
      const { operator, valueTail } = parseOperatorEnvelope(raw);
      if (operator === null) {
        return valueTail.length === 0
          ? null
          : build(id, defaultOperator, valueTail);
      }
      if (!allowed.has(operator)) {
        return raw.length === 0 ? null : build(id, defaultOperator, raw);
      }
      if (valueless.has(operator)) {
        return build(id, operator, undefined);
      }
      return valueTail.length === 0 ? null : build(id, operator, valueTail);
    },
  };
}

/**
 * A facet list spec (`condition`/`in` etc.): the param is the values, each
 * URL-encoded, comma-joined. The default operator encodes bare; other allowed
 * operators ride the envelope, and a valueless operator is an empty envelope.
 */
function listCodec(config: {
  column: string;
  kind: string;
  label: string;
  target: string | undefined;
  defaultOperator: string;
  allowedOperators: ReadonlyArray<string>;
  valuelessOperators: ReadonlyArray<string>;
}): SpecCodec {
  const allowed = new Set(config.allowedOperators);
  const valueless = new Set(config.valuelessOperators);

  const buildValues = (
    id: string,
    operator: string,
    values: Array<string>,
  ): FilterSpec => {
    const spec: FilterSpec = {
      id,
      column: config.column,
      kind: config.kind,
      operator,
      value: values,
      label: config.label,
    };
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  };

  const buildValueless = (id: string, operator: string): FilterSpec => {
    const spec: FilterSpec = {
      id,
      column: config.column,
      kind: config.kind,
      operator,
      label: config.label,
    };
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  };

  return {
    column: config.column,
    kind: config.kind,
    operator: config.defaultOperator,
    label: config.label,
    target: config.target,
    encode: (spec) => {
      const operator =
        typeof spec.operator === 'string'
          ? spec.operator
          : config.defaultOperator;
      if (valueless.has(operator)) {
        return encodeOperatorEnvelope(operator, '');
      }
      if (!Array.isArray(spec.value) || spec.value.length === 0) {
        return null;
      }
      const list = encodeList(spec.value);
      if (operator === config.defaultOperator) {
        return list;
      }
      if (!allowed.has(operator)) {
        return null;
      }
      return encodeOperatorEnvelope(operator, list);
    },
    decode: (id, raw) => {
      const { operator, valueTail } = parseOperatorEnvelope(raw);
      if (operator === null) {
        const values = decodeList(valueTail);
        return values.length === 0
          ? null
          : buildValues(id, config.defaultOperator, values);
      }
      if (!allowed.has(operator)) {
        const values = decodeList(raw);
        return values.length === 0
          ? null
          : buildValues(id, config.defaultOperator, values);
      }
      if (valueless.has(operator)) {
        return buildValueless(id, operator);
      }
      const values = decodeList(valueTail);
      return values.length === 0 ? null : buildValues(id, operator, values);
    },
  };
}

/**
 * A numeric `condition` spec: `op:value`, `between` as `op:lo:hi`, and a
 * valueless operator (`is_null` …) as a bare `op:` tail. Set-arity operators
 * are not representable here and encode to `null` (not persisted).
 */
function numericConditionCodec(config: {
  column: string;
  kind: string;
  label: string;
  target: string | undefined;
  operators: ReadonlyArray<OperatorDescriptor>;
}): SpecCodec {
  const arityById = new Map<string, OperatorDescriptor['arity']>();
  for (const operator of config.operators) {
    arityById.set(operator.id, operator.arity);
  }

  const build = (id: string, spec: Partial<FilterSpec>): FilterSpec => {
    const full: FilterSpec = {
      id,
      column: config.column,
      kind: config.kind,
      label: config.label,
      ...spec,
    };
    if (config.target !== undefined) {
      full.target = config.target;
    }
    return full;
  };

  return {
    column: config.column,
    kind: config.kind,
    label: config.label,
    target: config.target,
    encode: (spec) => {
      const operator = typeof spec.operator === 'string' ? spec.operator : '';
      if (!arityById.has(operator)) {
        return null;
      }
      const arity = arityById.get(operator);
      if (arity === 'none') {
        return `${operator}:`;
      }
      if (arity === 'set') {
        return null;
      }
      const value = Number(spec.value);
      if (!Number.isFinite(value)) {
        return null;
      }
      if (arity === 'range') {
        const valueTo = Number(spec.valueTo);
        if (!Number.isFinite(valueTo)) {
          return null;
        }
        return `${operator}:${value}:${valueTo}`;
      }
      return `${operator}:${value}`;
    },
    decode: (id, raw) => {
      const parsed = parseOperatorValue(raw);
      if (parsed === null || !arityById.has(parsed.operator)) {
        return null;
      }
      const { operator } = parsed;
      const arity = arityById.get(operator);
      if (arity === 'none') {
        return build(id, { operator });
      }
      if (arity === 'range') {
        const separator = parsed.value.indexOf(':');
        if (separator < 0) {
          return null;
        }
        const lo = toFiniteNumber(parsed.value.slice(0, separator));
        const hi = toFiniteNumber(parsed.value.slice(separator + 1));
        if (lo === null || hi === null) {
          return null;
        }
        return build(id, { operator, value: lo, valueTo: hi });
      }
      const value = toFiniteNumber(parsed.value);
      if (value === null) {
        return null;
      }
      return build(id, { operator, value });
    },
  };
}

/** An ISO date `interval`: the param is `lo..hi` (either bound may be empty). */
function intervalCodec(config: {
  column: string;
  label: string;
  target: string | undefined;
}): SpecCodec {
  const build = (id: string, lo: string | null, hi: string | null) => {
    const spec: FilterSpec = {
      id,
      column: config.column,
      kind: 'interval',
      value: [lo, hi],
      label: config.label,
    };
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  };

  return {
    column: config.column,
    kind: 'interval',
    label: config.label,
    target: config.target,
    encode: (spec) => {
      const bounds = Array.isArray(spec.value) ? spec.value : [null, null];
      const lo = typeof bounds[0] === 'string' ? bounds[0] : '';
      const hi = typeof bounds[1] === 'string' ? bounds[1] : '';
      if (lo === '' && hi === '') {
        return null;
      }
      return `${lo}..${hi}`;
    },
    decode: (id, raw) => {
      const separator = raw.indexOf('..');
      if (separator < 0) {
        return null;
      }
      const lo = raw.slice(0, separator);
      const hi = raw.slice(separator + 2);
      if (lo === '' && hi === '') {
        return null;
      }
      return build(id, lo === '' ? null : lo, hi === '' ? null : hi);
    },
  };
}

/** A metric threshold spec: the param is `op:value` (e.g. `gt:5000`). */
function metricThresholdCodec(config: {
  column: string;
  kind: string;
  label: string;
  allowedOperators: ReadonlyArray<string>;
}): SpecCodec {
  const allowed = new Set(config.allowedOperators);
  return {
    column: config.column,
    kind: config.kind,
    label: config.label,
    encode: (spec) => {
      const operator = typeof spec.operator === 'string' ? spec.operator : '';
      if (!allowed.has(operator)) {
        return null;
      }
      const value = Number(spec.value);
      if (!Number.isFinite(value) || value < 0) {
        return null;
      }
      return `${operator}:${value}`;
    },
    decode: (id, raw) => {
      const parsed = parseOperatorValue(raw);
      if (parsed === null || !allowed.has(parsed.operator)) {
        return null;
      }
      const value = toFiniteNumber(parsed.value);
      if (value === null || value < 0) {
        return null;
      }
      return {
        id,
        column: config.column,
        kind: config.kind,
        operator: parsed.operator,
        value,
        label: config.label,
      };
    },
  };
}

/** A multi-column points value envelope (rows publish's multi-field shape). */
interface PointsEnvelope {
  columns: Array<string>;
  tuples: Array<Array<unknown>>;
}

function isPointsEnvelope(value: unknown): value is PointsEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PointsEnvelope).columns) &&
    Array.isArray((value as PointsEnvelope).tuples)
  );
}

/**
 * A row-selection `points` spec. A single-field `publish.select` publishes a
 * FLAT scalar array (with `column` set to the group-by field); the multi-field
 * `{ columns, tuples }` envelope is tolerated defensively by taking each tuple's
 * first element. The param is the scalars, URL-encoded and comma-joined.
 */
function pointsCodec(config: { column: string; label: string }): SpecCodec {
  return {
    column: config.column,
    kind: 'points',
    label: config.label,
    encode: (spec) => {
      const values = Array.isArray(spec.value)
        ? spec.value
        : isPointsEnvelope(spec.value)
          ? spec.value.tuples.map((tuple) => tuple[0])
          : null;
      if (values === null || values.length === 0) {
        return null;
      }
      return encodeList(values);
    },
    decode: (id, raw) => {
      const values = decodeList(raw);
      if (values.length === 0) {
        return null;
      }
      return {
        id,
        column: config.column,
        kind: 'points',
        value: values,
        label: config.label,
      };
    },
  };
}

/**
 * The kind + operator a bridged detail-column filter resolves to, mirroring
 * `filter-bridge.ts` (`specKind`/`specOperator`). The codec family follows the
 * clause: string clauses → a bare/`op~`-less string, `in` → a comma list, and
 * `range`/`date-range` → `lo..hi` (numeric bounds / ISO bounds respectively).
 */
function bridgeColumnCodec(config: {
  id: string;
  column: string;
  clause: BridgeColumnSpec['clause'];
  label: string | undefined;
  target: string | undefined;
}): SpecCodec {
  const { clause } = config;
  const kind = bridgeSpecKind(clause);
  const operator = bridgeSpecOperator(clause);
  const label = config.label ?? config.column;

  const withStatic = (dynamic: Partial<FilterSpec>): FilterSpec => {
    const spec: FilterSpec = {
      id: config.id,
      column: config.column,
      kind,
      label,
      ...dynamic,
    };
    if (operator !== undefined) {
      spec.operator = operator;
    }
    if (config.target !== undefined) {
      spec.target = config.target;
    }
    return spec;
  };

  return {
    column: config.column,
    kind,
    operator,
    label,
    target: config.target,
    encode: (spec) => {
      if (clause === 'in') {
        if (!Array.isArray(spec.value) || spec.value.length === 0) {
          return null;
        }
        return encodeList(spec.value);
      }
      if (clause === 'range' || clause === 'date-range') {
        const bounds = Array.isArray(spec.value) ? spec.value : [null, null];
        const lo = bridgeBound(bounds[0], clause);
        const hi = bridgeBound(bounds[1], clause);
        if (lo === '' && hi === '') {
          return null;
        }
        return `${lo}..${hi}`;
      }
      // Scalar string / equality clauses: a non-empty bare string.
      if (spec.value === undefined || spec.value === null) {
        return null;
      }
      const text = String(spec.value);
      return text.length === 0 ? null : encodeURIComponent(text);
    },
    decode: (id, raw) => {
      if (clause === 'in') {
        const values = decodeList(raw);
        return values.length === 0 ? null : withStatic({ value: values });
      }
      if (clause === 'range' || clause === 'date-range') {
        const separator = raw.indexOf('..');
        if (separator < 0) {
          return null;
        }
        const loRaw = raw.slice(0, separator);
        const hiRaw = raw.slice(separator + 2);
        if (loRaw === '' && hiRaw === '') {
          return null;
        }
        const lo = decodeBridgeBound(loRaw, clause);
        const hi = decodeBridgeBound(hiRaw, clause);
        return withStatic({ value: [lo, hi] });
      }
      if (raw.length === 0) {
        return null;
      }
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // A malformed %-escape: keep the raw string.
      }
      return withStatic({ value: decoded });
    },
  };
}

/** Bridge clause → FilterSpec kind (mirrors `filter-bridge.ts` `specKind`). */
function bridgeSpecKind(clause: BridgeColumnSpec['clause']): string {
  switch (clause) {
    case 'equals':
      return 'point';
    case 'ilike':
    case 'prefix':
      return 'match';
    case 'range':
    case 'date-range':
      return 'interval';
    case 'in':
      return 'points';
  }
}

/** Bridge clause → FilterSpec operator (mirrors `specOperator`). */
function bridgeSpecOperator(
  clause: BridgeColumnSpec['clause'],
): string | undefined {
  if (clause === 'ilike') {
    return 'contains';
  }
  if (clause === 'prefix') {
    return 'prefix';
  }
  return undefined;
}

/** Serializes one range bound: numbers for `range`, ISO date for `date-range`. */
function bridgeBound(value: unknown, clause: 'range' | 'date-range'): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (clause === 'range') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/** Parses one range bound back to a number (`range`) or ISO string (`date-range`). */
function decodeBridgeBound(
  raw: string,
  clause: 'range' | 'date-range',
): number | string | null {
  if (raw === '') {
    return null;
  }
  if (clause === 'range') {
    return toFiniteNumber(raw);
  }
  return raw;
}

// ── Codec-family selection (derives each codec from the compiled spec) ────────

/** True when `kind` names a spec `filter_kinds` entry with aggregate-threshold behavior. */
function isAggregateThresholdKind(spec: DashboardSpec, kind: string): boolean {
  return spec.filter_kinds?.[kind]?.behavior === 'aggregate-threshold';
}

/**
 * The operator ids an aggregate-threshold kind advertises (its config list).
 * Only ever called for a kind {@link isAggregateThresholdKind} confirmed; an
 * unknown kind (not in `filter_kinds`) yields an empty vocabulary.
 */
function aggregateThresholdOperators(
  spec: DashboardSpec,
  kind: string,
): ReadonlyArray<string> {
  const def = spec.filter_kinds?.[kind];
  if (def === undefined) {
    return [];
  }
  return def.config.operators;
}

/**
 * The routing target a placement's spec should carry: none for `where` (the
 * default) and none for a self-routing kind (which emits its own targets); the
 * declared target otherwise.
 */
function placementTarget(
  spec: DashboardSpec,
  placement: FilterPlacementSpec,
): string | undefined {
  if (placement.target === 'where') {
    return undefined;
  }
  if (isAggregateThresholdKind(spec, placement.kind)) {
    return undefined;
  }
  return placement.target;
}

/** The allowed operator vocabulary a facet field offers, filtered by the kind. */
function facetOperatorConfig(
  field: FilterFieldSpec,
  kindRegistry: Record<string, FilterKind>,
  placementKind: string,
): {
  defaultOperator: string;
  allowedOperators: Array<string>;
  valuelessOperators: Array<string>;
} {
  const declared = kindRegistry[placementKind]?.operators ?? [];
  const subset =
    field.array_column === true
      ? FACET_ARRAY_OPERATORS
      : FACET_SCALAR_OPERATORS;
  const allowed = subset.filter((id) =>
    declared.some((entry) => entry.id === id),
  );
  const valueless = allowed.filter(
    (id) => declared.find((entry) => entry.id === id)?.arity === 'none',
  );
  return {
    defaultOperator: allowed[0] ?? subset[0] ?? 'in',
    allowedOperators: allowed,
    valuelessOperators: valueless,
  };
}

/** The codec for one filter placement, keyed generically by kind then value_kind. */
function codecForPlacement(
  spec: DashboardSpec,
  field: FilterFieldSpec,
  placement: FilterPlacementSpec,
  kindRegistry: Record<string, FilterKind>,
): SpecCodec {
  const column = placement.spec_column ?? field.column;
  const target = placementTarget(spec, placement);

  if (isAggregateThresholdKind(spec, placement.kind)) {
    return metricThresholdCodec({
      column,
      kind: placement.kind,
      label: field.label,
      allowedOperators: aggregateThresholdOperators(spec, placement.kind),
    });
  }

  switch (field.value_kind) {
    case 'facet': {
      const facet = facetOperatorConfig(field, kindRegistry, placement.kind);
      return listCodec({
        column,
        kind: placement.kind,
        label: field.label,
        target,
        defaultOperator: facet.defaultOperator,
        allowedOperators: facet.allowedOperators,
        valuelessOperators: facet.valuelessOperators,
      });
    }
    case 'text':
      return textConditionCodec({
        column,
        kind: placement.kind,
        label: field.label,
        target,
        operators: kindRegistry[placement.kind]?.operators ?? [],
      });
    case 'number':
      return numericConditionCodec({
        column,
        kind: placement.kind,
        label: field.label,
        target,
        operators: kindRegistry[placement.kind]?.operators ?? [],
      });
    case 'date':
      return intervalCodec({ column, label: field.label, target });
  }
}

/**
 * Derives the spec-id → codec registry from the compiled spec: filter
 * placements, then selection-table `publish` / `metric_threshold`, then
 * data-table `bridge_columns`. The FIRST registration of an id wins, so a spec
 * id shared across sites (e.g. a metric threshold declared both as a placement
 * and a widget control) resolves to one stable codec.
 */
export function buildFilterUrlRegistry(
  spec: DashboardSpec,
  kindRegistry: Record<string, FilterKind>,
): FilterUrlRegistry {
  const codecs = new Map<string, SpecCodec>();
  const register = (id: string, codec: SpecCodec): void => {
    if (codecs.has(id)) {
      return;
    }
    codecs.set(id, codec);
  };

  for (const field of spec.filters.fields) {
    for (const placement of field.placements) {
      register(
        placement.spec_id,
        codecForPlacement(spec, field, placement, kindRegistry),
      );
    }
  }

  for (const widget of Object.values(spec.widgets)) {
    if (widget.renderer === 'selection-table') {
      const publishColumn =
        widget.publish.fields[0] ?? widget.publish.columns[0] ?? '';
      register(
        widget.publish.spec_id,
        pointsCodec({ column: publishColumn, label: widget.publish.label }),
      );
      const threshold = widget.metric_threshold;
      if (threshold !== undefined) {
        register(
          threshold.spec_id,
          metricThresholdCodec({
            column: threshold.group_by,
            kind: threshold.kind,
            label: threshold.label,
            allowedOperators: aggregateThresholdOperators(spec, threshold.kind),
          }),
        );
      }
      continue;
    }
    if (widget.renderer === 'data-table') {
      for (const [columnId, config] of Object.entries(widget.bridge_columns)) {
        register(
          `${widget.id}:${columnId}`,
          bridgeColumnCodec({
            id: `${widget.id}:${columnId}`,
            column: config.column ?? columnId,
            clause: config.clause,
            label: config.label,
            target: config.target,
          }),
        );
      }
    }
  }

  return {
    get: (id) => codecs.get(id),
    ids: [...codecs.keys()],
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** The central `filters.defaults` list, in declaration order (empty when absent). */
function defaultEntries(spec: DashboardSpec): ReadonlyArray<FilterDefaultSpec> {
  return spec.filters.defaults ?? [];
}

/** Build a FilterSpec from a central default entry's static (registry) + dynamic parts. */
function buildDefaultSpec(
  entry: FilterDefaultSpec,
  codec: SpecCodec,
): FilterSpec {
  const spec: FilterSpec = {
    id: entry.spec_id,
    column: codec.column,
    kind: codec.kind,
    label: codec.label,
  };
  const operator = entry.operator ?? codec.operator;
  if (operator !== undefined) {
    spec.operator = operator;
  }
  if (entry.value !== undefined) {
    spec.value = entry.value;
  }
  if (entry.value_to !== undefined) {
    spec.valueTo = entry.value_to;
  }
  if (codec.target !== undefined) {
    spec.target = codec.target;
  }
  return spec;
}

/**
 * The internal list of default {@link FilterSpec}s the persister hydrates when
 * no owned param is present, built from the central `filters.defaults` list.
 * Unknown spec ids are skipped (validation reports them as compile errors ahead
 * of runtime).
 */
export function collectDefaultSpecs(
  spec: DashboardSpec,
  registry: FilterUrlRegistry,
): Array<FilterSpec> {
  const specs: Array<FilterSpec> = [];
  for (const entry of defaultEntries(spec)) {
    const codec = registry.get(entry.spec_id);
    if (codec === undefined) {
      continue;
    }
    specs.push(buildDefaultSpec(entry, codec));
  }
  return specs;
}

// ── Compile-time validation ──────────────────────────────────────────────────

/**
 * Compile-time checks for the URL-persistence layer:
 *
 * - a bare (prefix-less) `persist` must not derive any spec id equal to the
 *   reserved `spec` app param; and
 * - every `filters.defaults` entry's `spec_id` must resolve in the derived codec
 *   registry (unknown id → error naming it), and each default must round-trip
 *   through its codec's `encode` (a `null` result is a spec error, not a silent
 *   no-op).
 */
export function validateFilterUrl(
  spec: DashboardSpec,
  registry: FilterUrlRegistry,
  persistConfig: FilterPersistConfig | null,
): Array<string> {
  const errors: Array<string> = [];

  if (persistConfig !== null && persistConfig.prefix === undefined) {
    for (const id of registry.ids) {
      if (id === RESERVED_SPEC_PARAM) {
        errors.push(
          `filter spec id '${id}' collides with the reserved '${RESERVED_SPEC_PARAM}' URL param; declare a persist param_prefix to namespace persisted filters.`,
        );
      }
    }
  }

  for (const entry of defaultEntries(spec)) {
    const codec = registry.get(entry.spec_id);
    if (codec === undefined) {
      errors.push(
        `filters.defaults entry for spec '${entry.spec_id}' references a spec id that is not declared by any placement, publish, or metric_threshold.`,
      );
      continue;
    }
    if (codec.encode(buildDefaultSpec(entry, codec)) === null) {
      errors.push(
        `filters.defaults entry for spec '${entry.spec_id}' is invalid: it does not encode to a URL value (check its operator/value against the spec id's kind).`,
      );
    }
  }

  return errors;
}

// ── Persisters ───────────────────────────────────────────────────────────────

/** Owned-param helpers shared by the persister and the popover info. */
function ownershipHelpers(
  registry: FilterUrlRegistry,
  prefix: string | undefined,
): {
  owns: (name: string) => boolean;
  idFor: (name: string) => string;
  paramFor: (id: string) => string;
} {
  if (prefix !== undefined) {
    const dotted = `${prefix}.`;
    return {
      owns: (name) => name.startsWith(dotted),
      idFor: (name) => name.slice(dotted.length),
      paramFor: (id) => `${dotted}${id}`,
    };
  }
  return {
    owns: (name) => registry.get(name) !== undefined,
    idFor: (name) => name,
    paramFor: (id) => id,
  };
}

/**
 * The router I/O injected into the persister: the current search snapshot and
 * the search setter, both obtained from the router hooks by the wiring component.
 */
export interface PersisterIo {
  /** The URL search snapshot captured in the topology-construction render. */
  search: Search;
  /** The router's stable `navigateSearch` setter. */
  navigateSearch: (patch: SearchPatch, options?: NavigateSearchOptions) => void;
}

/**
 * Encode the complete app-owned FilterSet registry as one router patch.
 *
 * The caller decides when to navigate. Keeping this pure lets the dashboard's
 * React URL boundary merge FilterSet and standalone-selection changes into a
 * single navigation, which is important when `topology.reset()` clears both
 * stores in adjacent notification waves.
 */
export function buildFilterUrlPatch(
  registry: FilterUrlRegistry,
  prefix: string | undefined,
  specs: ReadonlyArray<FilterSpec> | null,
): Record<string, string | null> {
  const { paramFor } = ownershipHelpers(registry, prefix);
  const active = new Map<string, FilterSpec>();
  if (specs !== null) {
    for (const spec of specs) {
      active.set(spec.id, spec);
    }
  }

  // Patch the full registry: encoded value where active, null (delete) where
  // absent. Foreign params are never named, so they are never touched.
  const patch: Record<string, string | null> = {};
  for (const id of registry.ids) {
    const codec = registry.get(id);
    const spec = active.get(id);
    patch[paramFor(id)] =
      spec !== undefined && codec !== undefined ? codec.encode(spec) : null;
  }
  return patch;
}

/**
 * The URL {@link Persister} for a persisting filter-set entry, with router I/O
 * injected (never imported). Reads are synchronous against the captured `search`
 * snapshot (the FilterSet hydrates before its first query — zero flash); every
 * write uses `replace` (no history spam, no URL/filter desync).
 *
 * `write` patches the WHOLE derived registry rather than enumerating the live
 * URL: each registry spec id maps to its encoded value (active) or `null`
 * (absent). Deleting an absent key is a no-op and the router suppresses no-op
 * navigations, so this converges without reading the current params. One
 * consequence with a `param_prefix`: a stale prefixed param whose spec id is NOT
 * in the registry (e.g. a hand-edited URL) is left in place rather than swept.
 */
export function createUrlPersister(
  registry: FilterUrlRegistry,
  prefix: string | undefined,
  defaults: ReadonlyArray<FilterSpec>,
  io: PersisterIo,
): Persister<Array<FilterSpec>> {
  const { owns, idFor } = ownershipHelpers(registry, prefix);

  return {
    read: () => {
      const ownedNames = Object.keys(io.search).filter(owns);
      if (ownedNames.length === 0) {
        return defaults.length > 0 ? [...defaults] : null;
      }
      const specs: Array<FilterSpec> = [];
      for (const name of ownedNames) {
        const codec = registry.get(idFor(name));
        if (codec === undefined) {
          continue;
        }
        const raw = io.search[name];
        if (raw === undefined) {
          continue;
        }
        const spec = codec.decode(idFor(name), raw);
        if (spec !== null) {
          specs.push(spec);
        }
      }
      // URL wins wholesale: with owned params present, defaults are never merged
      // in — an all-malformed URL hydrates to nothing rather than the defaults.
      return specs.length > 0 ? specs : null;
    },

    write: (specs) => {
      io.navigateSearch(buildFilterUrlPatch(registry, prefix, specs), {
        history: 'replace',
      });
    },
  };
}

/**
 * A synthetic persister used when defaults exist but no `persist` is declared:
 * it hydrates the defaults once and never writes, so there is exactly one
 * hydration path regardless of whether persistence is on.
 */
export function createDefaultsPersister(
  defaults: ReadonlyArray<FilterSpec>,
): Persister<Array<FilterSpec>> {
  return {
    read: () => (defaults.length > 0 ? [...defaults] : null),
    write: () => {},
  };
}

/** FilterSet inputs carried by the compiled app-owned URL-state layer. */
export interface FilterPersistWiring {
  registry: FilterUrlRegistry;
  persistConfig: FilterPersistConfig | null;
  defaults: ReadonlyArray<FilterSpec>;
}

// ── Popover info (reactive param classification for the URL-params panel) ─────

/** Ownership class of a search param, for the URL-params popover badge. */
export type ParamOwnership = 'spec' | 'filter' | 'other';

/** Read-only view the URL-params popover uses to classify + describe params. */
export interface FilterUrlInfo {
  /** True when the active spec declared URL persistence. */
  readonly enabled: boolean;
  /** The param prefix in effect, or `undefined` for bare param names. */
  readonly prefix: string | undefined;
  /** Classify a param name as the reserved app param, a filter, or other. */
  classify: (name: string) => ParamOwnership;
  /** A human-readable rendering of a filter param's value, or `null`. */
  describe: (name: string, value: string) => string | null;
}

/** Compact, human-readable rendering of a decoded spec's dynamic parts. */
function describeSpec(spec: FilterSpec): string {
  const parts: Array<string> = [];
  if (typeof spec.operator === 'string') {
    parts.push(spec.operator);
  }
  if (Array.isArray(spec.value)) {
    parts.push(spec.value.map((entry) => String(entry ?? '')).join(', '));
  } else if (spec.value !== undefined && spec.value !== null) {
    parts.push(String(spec.value));
  }
  if (spec.valueTo !== undefined && spec.valueTo !== null) {
    parts.push(`… ${String(spec.valueTo)}`);
  }
  return parts.join(' ').trim();
}

/** Build the popover's param-classification view from the registry + config. */
export function buildFilterUrlInfo(
  registry: FilterUrlRegistry,
  persistConfig: FilterPersistConfig | null,
): FilterUrlInfo {
  const prefix = persistConfig?.prefix;
  const enabled = persistConfig !== null;
  const { owns, idFor } = ownershipHelpers(registry, prefix);

  return {
    enabled,
    prefix,
    classify: (name) => {
      if (name === RESERVED_SPEC_PARAM) {
        return 'spec';
      }
      if (enabled && owns(name)) {
        return 'filter';
      }
      return 'other';
    },
    describe: (name, value) => {
      if (!enabled || !owns(name)) {
        return null;
      }
      const codec = registry.get(idFor(name));
      if (codec === undefined) {
        return null;
      }
      const spec = codec.decode(idFor(name), value);
      if (spec === null) {
        return null;
      }
      const described = describeSpec(spec);
      return described.length > 0 ? described : null;
    },
  };
}

// ── Persist-config resolution ────────────────────────────────────────────────

/**
 * The first `filter-set` entry that declares `persist`, resolved to its entry
 * name + param prefix. `null` when no entry persists (defaults, if any, then
 * hydrate through a synthetic persister).
 */
export function resolveFilterPersistConfig(
  topology: TopologySpec,
): FilterPersistConfig | null {
  for (const [name, declaration] of Object.entries(topology)) {
    if (declaration.type !== 'filter-set') {
      continue;
    }
    const persist = declaration.persist;
    if (persist === undefined) {
      continue;
    }
    return { entryName: name, prefix: persist.param_prefix };
  }
  return null;
}
