/**
 * Pure compile/runtime vocabulary for URL-persisted standalone Selections.
 *
 * The app owns this contract. Mosaic sees only the reconstructed clause; it does
 * not know about parameter names, codecs, trusted columns, or this dashboard's
 * YAML shape. v1 intentionally supports only finite numeric 1D intervals.
 */
import type { FilterPersistConfig, FilterUrlRegistry } from '../filter-url';
import type { TopologySpec } from '../schema';

const PARAM_PREFIX = 's';
const NUMBER_TOKEN = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const INTERVAL_GRAMMAR = new RegExp(
  `^(${NUMBER_TOKEN})\\.\\.(${NUMBER_TOKEN})$`,
);

export type NumericInterval = [number, number];

export interface SelectionUrlDescriptor {
  /** Bare topology entry/ref receiving the restored clause. */
  entry: string;
  ref: string;
  /** Derived application-owned parameter name (`s.<entry>`). */
  param: string;
  /** Trusted SQL column from the spec, never the URL. */
  column: string;
  valueType: 'interval';
  dataType: 'number';
}

export interface SelectionUrlRegistry {
  readonly entries: ReadonlyArray<SelectionUrlDescriptor>;
  getByEntry: (entry: string) => SelectionUrlDescriptor | undefined;
  getByParam: (param: string) => SelectionUrlDescriptor | undefined;
}

/** Build the ordered descriptor registry. Invalid strategy use is reported later. */
export function buildSelectionUrlRegistry(
  topology: TopologySpec,
): SelectionUrlRegistry {
  const entries: Array<SelectionUrlDescriptor> = [];
  for (const [entry, declaration] of Object.entries(topology)) {
    if (declaration.type === 'filter-set' || declaration.type === 'compose') {
      continue;
    }
    const persist = declaration.persist;
    if (persist === undefined) {
      continue;
    }
    entries.push({
      entry,
      ref: entry,
      param: `${PARAM_PREFIX}.${entry}`,
      column: persist.value.column,
      valueType: persist.value.type,
      dataType: persist.value.data_type,
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

/** Encode a strict, ascending finite numeric interval. */
export function encodeNumericInterval(value: unknown): string | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[0] > value[1]
  ) {
    return null;
  }
  return `${String(value[0])}..${String(value[1])}`;
}

/** Decode the exact `lo..hi` grammar, rejecting malformed/reversed bounds. */
export function decodeNumericInterval(raw: string): NumericInterval | null {
  const match = INTERVAL_GRAMMAR.exec(raw);
  if (match === null) {
    return null;
  }
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
    return null;
  }
  return [lo, hi];
}

/**
 * Validate semantics spanning topology strategy and the complete URL namespace.
 */
export function validateSelectionUrl(
  topology: TopologySpec,
  selections: SelectionUrlRegistry,
  filters: FilterUrlRegistry,
  filterPersist: FilterPersistConfig | null,
): Array<string> {
  const errors: Array<string> = [];
  for (const descriptor of selections.entries) {
    const declaration = topology[descriptor.entry];
    if (declaration?.type !== 'single') {
      errors.push(
        `topology entry '${descriptor.entry}' declares selection persistence but has type '${declaration?.type ?? 'unknown'}'; persisted selections must use type 'single'.`,
      );
    }

    if (filterPersist?.prefix === PARAM_PREFIX) {
      errors.push(
        `topology entry '${descriptor.entry}' derives URL param '${descriptor.param}', which collides with filter-set param_prefix '${PARAM_PREFIX}'.`,
      );
      continue;
    }
    if (
      filterPersist !== null &&
      filterPersist.prefix === undefined &&
      filters.get(descriptor.param) !== undefined
    ) {
      errors.push(
        `topology entry '${descriptor.entry}' derives URL param '${descriptor.param}', which collides with a bare persisted filter spec id.`,
      );
    }
  }
  return errors;
}
