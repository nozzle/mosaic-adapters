/**
 * The filter registry: one page-level object that watches registered
 * Selections and normalizes their active clauses into a flat, ordered list
 * of removable chips — the data behind an active-filter bar — plus the
 * global-reset backbone (`resetAll`).
 *
 * Like Selections, a registry is a plain long-lived object created next to
 * the page's Selection topology; framework bindings only subscribe to its
 * store. It never builds new predicate *logic*: chip removal either clears
 * the source's clause or narrows a point-list clause through the same
 * `clausePoints` factory the publisher used.
 */
import { clausePoints } from '@uwdata/mosaic-core';
import { Store } from '@tanstack/store';
import { createClearClause } from './clause-factory';
import { SqlIdentifier, createStructAccess } from './sql-access';
import type {
  ClauseSource,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';

export interface FilterRegistryGroup {
  id: string;
  label: string;
  /** Lower sorts earlier in the chip list. Unregistered groups sort last. */
  priority: number;
}

export interface FilterRegistration {
  /** Chip group this selection's filters belong to. */
  group: string;
  /**
   * Fixed chip label for every clause on this selection — the common case
   * of a Selection with a single logical publisher ("Domain", "Selected
   * Keyword"). Takes precedence over `labelMap`.
   */
  label?: string;
  /**
   * Per-source labels for multi-publisher Selections (e.g. a column-filter
   * bridge), keyed by the source's `column` or `id` descriptor; `'*'` is the
   * fallback. Sources without a match self-label from the same descriptors.
   */
  labelMap?: Record<string, string>;
  /** Custom chip-value formatting (applied after explosion/unwrapping). */
  formatValue?: (value: unknown) => string;
  /**
   * Explode multi-value clauses (point-list tuples, plain arrays) into one
   * chip per value instead of a single joined chip.
   */
  explodeValues?: boolean;
  /**
   * SQL fields for narrowing a point-list clause when a single exploded chip
   * is removed (dotted paths become struct access) — pass the same fields
   * the publisher's `publish.select` uses. Without them, removing any
   * exploded chip clears the source's whole clause.
   */
  fields?: Array<string>;
}

export interface FilterChip {
  /** Stable-ish identity for rendering keys. */
  id: string;
  group: string;
  label: string;
  /** The chip's value (a single value when exploded from a multi-value clause). */
  value: unknown;
  formattedValue: string;
  selection: Selection;
  source: ClauseSource;
  /** For exploded point-list chips: this chip's tuple within the clause value. */
  tuple?: Array<unknown>;
}

export interface FilterRegistryState {
  chips: Array<FilterChip>;
}

interface Registration extends FilterRegistration {
  selection: Selection;
  listener: () => void;
}

/**
 * Filter-builder committed values travel as `StoredFilterValue` envelopes
 * ({ mode, operator, value, valueTo, … }); chips display the payload.
 */
interface StoredValueEnvelope {
  mode: string;
  value?: unknown;
  valueTo?: unknown;
}

function isStoredValueEnvelope(value: unknown): value is StoredValueEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    typeof value.mode === 'string' &&
    'filterId' in value
  );
}

function isTupleArray(value: unknown): value is Array<Array<unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every(Array.isArray);
}

interface SourceDescriptor {
  column?: unknown;
  id?: unknown;
  debugName?: unknown;
}

function resolveSourceKeys(source: ClauseSource): Array<string> {
  const descriptor = source as SourceDescriptor;
  const keys: Array<string> = [];
  for (const candidate of [
    descriptor.column,
    descriptor.id,
    descriptor.debugName,
  ]) {
    if (typeof candidate === 'string' && candidate !== '') {
      keys.push(candidate);
    }
  }
  return keys;
}

function formatChipValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      (typeof value[0] === 'number' || typeof value[1] === 'number')
    ) {
      return `${formatChipValue(value[0])} - ${formatChipValue(value[1])}`;
    }
    return value.map((item) => formatChipValue(item)).join(', ');
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[complex value]';
    }
  }
  return String(value);
}

function chipKey(value: unknown): string {
  try {
    // Chip values are never `undefined` (nullish clause values render no
    // chips), so stringify always yields a string here.
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The Selection's synchronously-maintained clause list. `selection.clauses`
 * reads the last *emitted* value event, which lags one tick once listeners
 * are attached; `_resolved` is upstream's always-current resolution state.
 */
function resolvedClauses(selection: Selection): Array<SelectionClause> {
  return selection._resolved;
}

export interface FilterRegistry {
  /** Read chips from `store.state`, subscribe via `store.subscribe`. */
  readonly store: Store<FilterRegistryState>;
  /** Declare a chip group; chips sort by group priority. Idempotent. */
  registerGroup: (group: FilterRegistryGroup) => void;
  /**
   * Track a Selection's clauses as chips (and include it in `resetAll`).
   * Re-registering a selection replaces its configuration.
   * @returns an unregister function.
   */
  register: (
    selection: Selection,
    registration: FilterRegistration,
  ) => () => void;
  /**
   * Include a Selection in `resetAll` without rendering chips for it (e.g.
   * a HAVING-routed companion Selection whose chip lives elsewhere).
   * @returns an unregister function.
   */
  registerForReset: (selection: Selection) => () => void;
  /**
   * Remove one chip: clears the source's clause, or — for exploded
   * point-list chips of a registration with `fields` — republishes the
   * clause narrowed to the remaining tuples.
   */
  removeChip: (chip: FilterChip) => void;
  /** `selection.reset()` on every registered selection (chips and reset-only). */
  resetAll: () => void;
  /** Detach every listener and empty the store. */
  destroy: () => void;
}

export function createFilterRegistry(): FilterRegistry {
  return new ChipFilterRegistry();
}

class ChipFilterRegistry implements FilterRegistry {
  readonly store = new Store<FilterRegistryState>({ chips: [] });

  readonly #groups = new Map<string, FilterRegistryGroup>();
  readonly #registrations = new Map<Selection, Registration>();
  readonly #resetOnly = new Set<Selection>();
  #destroyed = false;

  registerGroup(group: FilterRegistryGroup): void {
    if (this.#destroyed) {
      return;
    }
    this.#groups.set(group.id, group);
    this.#recompute();
  }

  register(selection: Selection, registration: FilterRegistration): () => void {
    if (this.#destroyed) {
      return () => {};
    }
    this.#unregister(selection);
    const listener = () => this.#recompute();
    this.#registrations.set(selection, {
      ...registration,
      selection,
      listener,
    });
    selection.addEventListener('value', listener);
    this.#recompute();
    return () => {
      this.#unregister(selection);
      this.#recompute();
    };
  }

  registerForReset(selection: Selection): () => void {
    if (this.#destroyed) {
      return () => {};
    }
    this.#resetOnly.add(selection);
    return () => {
      this.#resetOnly.delete(selection);
    };
  }

  removeChip(chip: FilterChip): void {
    if (this.#destroyed) {
      return;
    }
    const registration = this.#registrations.get(chip.selection);
    const clause = resolvedClauses(chip.selection).find(
      (candidate) => candidate.source === chip.source,
    );
    if (!clause) {
      return;
    }

    if (
      chip.tuple !== undefined &&
      registration?.fields !== undefined &&
      isTupleArray(clause.value)
    ) {
      const remaining = clause.value.filter((tuple) => tuple !== chip.tuple);
      if (remaining.length > 0) {
        const fields = registration.fields.map((field) =>
          createStructAccess(SqlIdentifier.from(field)),
        );
        chip.selection.update(
          clausePoints(fields, remaining, {
            source: clause.source,
            clients: clause.clients,
          }),
        );
        return;
      }
    }

    chip.selection.update(createClearClause(clause.source, clause.clients));
  }

  resetAll(): void {
    if (this.#destroyed) {
      return;
    }
    for (const selection of this.#registrations.keys()) {
      selection.reset();
    }
    for (const selection of this.#resetOnly) {
      selection.reset();
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    for (const registration of this.#registrations.values()) {
      registration.selection.removeEventListener(
        'value',
        registration.listener,
      );
    }
    this.#registrations.clear();
    this.#resetOnly.clear();
    this.#groups.clear();
    this.store.setState(() => ({ chips: [] }));
  }

  #unregister(selection: Selection): void {
    const registration = this.#registrations.get(selection);
    if (!registration) {
      return;
    }
    selection.removeEventListener('value', registration.listener);
    this.#registrations.delete(selection);
  }

  #recompute(): void {
    const chips: Array<FilterChip> = [];
    for (const registration of this.#registrations.values()) {
      for (const clause of resolvedClauses(registration.selection)) {
        this.#collectChips(chips, registration, clause);
      }
    }
    chips.sort(
      (a, b) => this.#groupPriority(a.group) - this.#groupPriority(b.group),
    );
    this.store.setState(() => ({ chips }));
  }

  #groupPriority(groupId: string): number {
    return this.#groups.get(groupId)?.priority ?? Number.MAX_SAFE_INTEGER;
  }

  #collectChips(
    chips: Array<FilterChip>,
    registration: Registration,
    clause: SelectionClause,
  ): void {
    const rawValue = isStoredValueEnvelope(clause.value)
      ? this.#unwrapEnvelope(clause.value)
      : clause.value;
    if (rawValue === null || rawValue === undefined) {
      return;
    }

    if (registration.explodeValues && isTupleArray(rawValue)) {
      for (const tuple of rawValue) {
        const value = tuple.length === 1 ? tuple[0] : tuple;
        chips.push(this.#buildChip(registration, clause, value, tuple));
      }
      return;
    }
    if (registration.explodeValues && Array.isArray(rawValue)) {
      for (const value of rawValue) {
        chips.push(this.#buildChip(registration, clause, value));
      }
      return;
    }
    chips.push(this.#buildChip(registration, clause, rawValue));
  }

  /**
   * Range-shaped envelopes carry the payload as value/valueTo; everything
   * else displays the committed `value`.
   */
  #unwrapEnvelope(envelope: StoredValueEnvelope): unknown {
    const { value, valueTo } = envelope;
    if (valueTo !== null && valueTo !== undefined && !Array.isArray(value)) {
      return [value, valueTo];
    }
    return value ?? null;
  }

  #buildChip(
    registration: Registration,
    clause: SelectionClause,
    value: unknown,
    tuple?: Array<unknown>,
  ): FilterChip {
    const sourceKeys = resolveSourceKeys(clause.source);
    let label = registration.label;
    if (label === undefined && registration.labelMap) {
      for (const key of sourceKeys) {
        const mapped = registration.labelMap[key];
        if (mapped !== undefined) {
          label = mapped;
          break;
        }
      }
      label ??= registration.labelMap['*'];
    }
    label ??= sourceKeys[0] ?? 'filter';

    const formattedValue = registration.formatValue
      ? registration.formatValue(value)
      : formatChipValue(value);

    return {
      id: `${registration.group}:${sourceKeys[0] ?? 'source'}:${chipKey(value)}`,
      group: registration.group,
      label,
      value,
      formattedValue,
      selection: registration.selection,
      source: clause.source,
      tuple,
    };
  }
}
