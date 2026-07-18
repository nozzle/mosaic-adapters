/**
 * Pure compile/runtime vocabulary for URL-persisted `variable`s (topology-owned
 * Mosaic Params).
 *
 * The app owns this contract; the library sees only a `Persister<ParamValue>`
 * (passed via `options.paramOptions[entry].persist`). Core drives hydration
 * (a non-nullish persisted value WINS over the declared default) and
 * write-through (every value change replaces the owned URL param) through its
 * `PersisterLifecycle`; this module supplies the codec and the router-bound
 * persister.
 *
 * ## URL param name
 *
 * Each persisted variable owns ONE search param, named `v.<entry>` by the house
 * convention (the same `<class>.<name>` family as selection persist's
 * `s.<entry>`), unless the spec overrides it with `persist.param`.
 *
 * ## URL value grammar (a type-tagged extension of the filter list dialect)
 *
 * A {@link ParamValue} is a scalar or a FLAT array of scalars of mixed type, so
 * the codec is type-preserving (a select's `option.value === current` match is
 * strict). Each scalar is a one-char tag + payload; an array is `@` + the scalar
 * tokens, comma-joined (each string payload `%`-encoded, so a literal comma in a
 * value never breaks the split — the same per-element encoding filter lists use).
 *
 * - string  → `s<encodeURIComponent(value)>`  (e.g. `stitle`)
 * - number  → `n<value>`                       (finite only; e.g. `n42`, `n-3.5`)
 * - boolean → `b1` / `b0`
 * - null    → `z`
 * - array   → `@` + tokens joined by `,`       (empty array → `@`)
 *
 * A scalar token never starts with `@`, so the leading char disambiguates a
 * scalar from an array. Malformed input decodes to `null` and is skipped
 * defensively (core keeps the declared default).
 */
import type { FilterPersistConfig, FilterUrlRegistry } from '../filter-url';
import type { SelectionUrlRegistry } from './selection-url';
import type { ParamValue, Persister } from '@nozzleio/react-mosaic';
import type { Search } from '@/router';
import type { TopologySpec } from '../schema';

/** The URL-param class prefix a house-convention variable param carries. */
export const VARIABLE_PARAM_PREFIX = 'v';

/** The reserved app param that selects the active dashboard spec. */
const RESERVED_SPEC_PARAM = 'spec';

/** A scalar the {@link ParamValue} domain allows. */
type Scalar = string | number | boolean | null;

export interface VariableUrlDescriptor {
  /** Bare topology entry declaring the variable. */
  entry: string;
  /** The owned URL search-param name (`v.<entry>` unless overridden). */
  param: string;
}

export interface VariableUrlRegistry {
  readonly entries: ReadonlyArray<VariableUrlDescriptor>;
  getByEntry: (entry: string) => VariableUrlDescriptor | undefined;
  getByParam: (param: string) => VariableUrlDescriptor | undefined;
}

/** Build the ordered descriptor registry for every persisted `variable`. */
export function buildVariableUrlRegistry(
  topology: TopologySpec,
): VariableUrlRegistry {
  const entries: Array<VariableUrlDescriptor> = [];
  for (const [entry, declaration] of Object.entries(topology)) {
    if (declaration.type !== 'variable') {
      continue;
    }
    const persist = declaration.persist;
    if (persist === undefined) {
      continue;
    }
    entries.push({
      entry,
      param: persist.param ?? `${VARIABLE_PARAM_PREFIX}.${entry}`,
    });
  }
  const byEntry = new Map(entries.map((entry) => [entry.entry, entry]));
  const byParam = new Map(entries.map((entry) => [entry.param, entry]));
  return {
    entries,
    getByEntry: (entry) => byEntry.get(entry),
    getByParam: (param) => byParam.get(param),
  };
}

/**
 * Validate that every persisted variable's derived URL param is unique and does
 * not collide with the reserved `spec` app param, the filter-set namespace, a
 * persisted selection param, or another variable — the full URL namespace, so a
 * shared link can never route two owners onto one key.
 */
export function validateVariableUrl(
  variables: VariableUrlRegistry,
  filters: FilterUrlRegistry,
  filterPersist: FilterPersistConfig | null,
  selections: SelectionUrlRegistry,
): Array<string> {
  const errors: Array<string> = [];
  const seen = new Set<string>();

  const collidesWithFilter = (param: string): boolean => {
    if (filterPersist === null) {
      return false;
    }
    if (filterPersist.prefix !== undefined) {
      return param.startsWith(`${filterPersist.prefix}.`);
    }
    return filters.get(param) !== undefined;
  };

  for (const descriptor of variables.entries) {
    const { entry, param } = descriptor;
    if (param === RESERVED_SPEC_PARAM) {
      errors.push(
        `variable '${entry}' derives URL param '${param}', which collides with the reserved '${RESERVED_SPEC_PARAM}' app param; set a different persist param.`,
      );
    }
    if (collidesWithFilter(param)) {
      errors.push(
        `variable '${entry}' derives URL param '${param}', which collides with a persisted filter param.`,
      );
    }
    if (selections.getByParam(param) !== undefined) {
      errors.push(
        `variable '${entry}' derives URL param '${param}', which collides with a persisted selection param.`,
      );
    }
    if (seen.has(param)) {
      errors.push(
        `variable '${entry}' derives URL param '${param}', which is already owned by another persisted variable.`,
      );
    }
    seen.add(param);
  }
  return errors;
}

// ── Codec ─────────────────────────────────────────────────────────────────────

/** Encode one scalar to its tagged token, or `null` when unrepresentable. */
function encodeScalar(value: Scalar): string | null {
  if (value === null) {
    return 'z';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'b1' : 'b0';
    case 'number':
      return Number.isFinite(value) ? `n${String(value)}` : null;
    case 'string':
      return `s${encodeURIComponent(value)}`;
    default:
      return null;
  }
}

/** Decode one tagged token, or `null` when malformed. Wrapped so a decoded `null` is distinguishable from failure. */
function decodeScalar(token: string): { value: Scalar } | null {
  const tag = token[0];
  const payload = token.slice(1);
  switch (tag) {
    case 'z':
      return payload === '' ? { value: null } : null;
    case 'b':
      if (payload === '1') {
        return { value: true };
      }
      return payload === '0' ? { value: false } : null;
    case 'n': {
      if (payload === '') {
        return null;
      }
      const parsed = Number(payload);
      return Number.isFinite(parsed) ? { value: parsed } : null;
    }
    case 's':
      try {
        return { value: decodeURIComponent(payload) };
      } catch {
        return null;
      }
    default:
      return null;
  }
}

/** Encode a full {@link ParamValue} (scalar or flat array), or `null` when unrepresentable. */
export function encodeParamValue(value: ParamValue): string | null {
  if (Array.isArray(value)) {
    const tokens: Array<string> = [];
    for (const element of value) {
      const token = encodeScalar(element);
      if (token === null) {
        return null;
      }
      tokens.push(token);
    }
    return `@${tokens.join(',')}`;
  }
  return encodeScalar(value);
}

/**
 * Decode a URL value to a {@link ParamValue}, or `null` when malformed. Returns
 * a `{ value }` wrapper so a decoded `null` (a legal ParamValue) is
 * distinguishable from a decode failure.
 */
export function decodeParamValue(raw: string): { value: ParamValue } | null {
  if (raw.startsWith('@')) {
    const body = raw.slice(1);
    if (body === '') {
      return { value: [] };
    }
    const values: Array<Scalar> = [];
    for (const token of body.split(',')) {
      const decoded = decodeScalar(token);
      if (decoded === null) {
        return null;
      }
      values.push(decoded.value);
    }
    return { value: values };
  }
  const decoded = decodeScalar(raw);
  return decoded === null ? null : { value: decoded.value };
}

// ── Persister + options wiring ─────────────────────────────────────────────────

/**
 * The router I/O the persister reads/commits through, provided by a getter so a
 * stable (memoized) persister always sees the current snapshot. `read` runs once
 * during topology construction against the then-current URL; `commit` runs on
 * later value changes.
 */
export interface VariablePersisterIo {
  /** The URL search snapshot captured at construction (read only). */
  search: Search;
  /**
   * Enqueue a URL patch through the app's shared, coalescing commit queue — the
   * SAME debounced/replace machinery the FilterSet + Selection writes use, so a
   * variable change merges into one navigation with adjacent state writes rather
   * than firing its own extra navigation (which would re-render the whole tree
   * mid-requery and race the bound clients).
   */
  commit: (patch: Record<string, string | null>) => void;
}

/**
 * A `Persister<ParamValue>` for one owned variable, router I/O injected via a
 * getter. `read` decodes the owned param from the current URL (absent/malformed
 * → `null`, so core keeps the declared default). `write` patches the owned param
 * with the encoded value (or deletes it when the value is nullish /
 * unrepresentable) through the shared commit queue.
 */
export function createVariableUrlPersister(
  param: string,
  getIo: () => VariablePersisterIo,
): Persister<ParamValue> {
  return {
    read: () => {
      const raw = getIo().search[param];
      if (raw === undefined) {
        return null;
      }
      const decoded = decodeParamValue(raw);
      return decoded === null ? null : decoded.value;
    },
    write: (value) => {
      const encoded = value === null ? null : encodeParamValue(value);
      getIo().commit({ [param]: encoded });
    },
  };
}

/** Code-only per-param persist options keyed by entry, or `undefined` when none persist. */
export function buildVariableParamOptions(
  registry: VariableUrlRegistry,
  getIo: () => VariablePersisterIo,
): Record<string, { persist: Persister<ParamValue> }> | undefined {
  if (registry.entries.length === 0) {
    return undefined;
  }
  const paramOptions: Record<string, { persist: Persister<ParamValue> }> = {};
  for (const descriptor of registry.entries) {
    paramOptions[descriptor.entry] = {
      persist: createVariableUrlPersister(descriptor.param, getIo),
    };
  }
  return paramOptions;
}
