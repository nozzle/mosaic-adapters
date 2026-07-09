/**
 * Removable chips for every active filter on the page. Chips are the UNION of:
 *
 * - **FilterSet chips** (`useFilterSetChips` → the primary set's store): each
 *   carries its own label / formatted value / resolved routing target /
 *   operator; removing one narrows or drops the spec (`removeChip`).
 * - **Foreign clauses** (`useMosaicActiveClauses`): clauses on topology-owned
 *   Selections the FilterSet does NOT source — here the volume brush interval.
 *   Core already excludes FilterSet-sourced clauses, so this set is exactly the
 *   foreign ones. Clearing one publishes a null-predicate clause for the WHOLE
 *   clause.
 *
 * "Clear All" is `topology.reset()` — clearing both the FilterSet specs AND the
 * non-FilterSet selections in one call.
 *
 * `data-testid`s: the bar is `active-filter-bar`; each chip is
 * `filter-chip-<sanitized>` where the sanitized suffix is the chip key with
 * every character outside `[A-Za-z0-9_-]` replaced by `-` (so `text:field_a` →
 * `filter-chip-text-field_a`, an exploded `facet:field_b:0` →
 * `filter-chip-facet-field_b-0`, a foreign selection ref `range_select` →
 * `filter-chip-range_select`); Clear All is `clear-all-filters`.
 */
import { useMemo } from 'react';
import {
  useFilterSetChips,
  useMosaicActiveClauses,
} from '@nozzleio/react-mosaic';
import type {
  FilterSet,
  FilterSetChip,
  Topology,
} from '@nozzleio/react-mosaic';

interface ActiveFilterChip {
  key: string;
  /** Stable suffix for the chip's `data-testid`. */
  testKey: string;
  label: string;
  value: string;
  target: string;
  operator: string | undefined;
  foreign: boolean;
  remove: () => void;
}

/** Sanitize an id/ref into a `data-testid`-safe suffix. */
function sanitize(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** Reads a `{ column }` annotation off a foreign clause's declaration meta. */
function readColumn(meta: unknown): string | undefined {
  if (typeof meta === 'object' && meta !== null && 'column' in meta) {
    const column = (meta as { column?: unknown }).column;
    return typeof column === 'string' ? column : undefined;
  }
  return undefined;
}

/** Formats a foreign clause's value for display. */
function formatForeignValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((n) => typeof n === 'number')) {
      const [lo, hi] = value as [number, number];
      const round = (n: number) => Math.round(n).toLocaleString('en-US');
      return `${round(lo)} – ${round(hi)}`;
    }
    return value.map((entry) => String(entry)).join(', ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/** Short placement badge derived from a chip's routing target. */
function placementBadge(chip: ActiveFilterChip): string {
  if (chip.foreign) {
    return 'BRUSH';
  }
  if (chip.target.startsWith('having:') || chip.target.startsWith('members:')) {
    return 'HAVING';
  }
  return 'WHERE';
}

/** Group rank so foreign clauses trail the FilterSet chips. */
function chipRank(chip: ActiveFilterChip): number {
  if (chip.foreign) {
    return 4;
  }
  if (chip.key.startsWith('fs:select:') || chip.key.startsWith('fs:metric:')) {
    return 2;
  }
  return 1;
}

export interface ActiveFilterBarProps {
  topology: Topology;
  filterSet: FilterSet;
}

export function ActiveFilterBar(props: ActiveFilterBarProps) {
  const { topology, filterSet } = props;
  const filterSetChips = useFilterSetChips(filterSet);
  const foreignClauses = useMosaicActiveClauses();

  const chips = useMemo<Array<ActiveFilterChip>>(() => {
    const next: Array<ActiveFilterChip> = filterSetChips.map(
      (chip: FilterSetChip) => ({
        key: `fs:${chip.key}`,
        testKey: sanitize(chip.key),
        label: chip.label,
        value: chip.formattedValue,
        target: chip.target,
        operator: chip.operator,
        foreign: false,
        remove: () => filterSet.removeChip(chip),
      }),
    );

    for (const active of foreignClauses) {
      const column = readColumn(active.meta);
      next.push({
        key: `foreign:${active.ref}`,
        testKey: sanitize(active.ref),
        label: active.label ?? column ?? active.entry,
        value: formatForeignValue(active.clause.value),
        target: active.ref,
        operator: undefined,
        foreign: true,
        remove: () => {
          topology.resolve(active.ref).update({
            source: active.clause.source,
            value: null,
            predicate: null,
          });
        },
      });
    }

    return next;
  }, [topology, filterSet, filterSetChips, foreignClauses]);

  if (chips.length === 0) {
    return null;
  }

  const ordered = chips
    .map((chip, index) => ({ chip, index }))
    .sort((a, b) => chipRank(a.chip) - chipRank(b.chip) || a.index - b.index)
    .map((entry) => entry.chip);

  return (
    <div
      data-testid="active-filter-bar"
      className="flex flex-wrap items-center gap-1.5"
    >
      <div className="mr-1 text-[11px] font-medium tracking-wide text-faint uppercase">
        Active
      </div>

      {ordered.map((chip) => (
        <div
          key={chip.key}
          data-testid={`filter-chip-${chip.testKey}`}
          className={`flex items-center gap-1 rounded-gf border py-0.5 pr-1 pl-1.5 text-xs transition-colors ${
            chip.foreign
              ? 'border-gf-purple/40 bg-gf-purple/10 text-ink'
              : 'border-gf-blue/40 bg-gf-blue/10 text-ink'
          }`}
        >
          <span
            data-testid="chip-target"
            className="rounded-[1px] bg-gf-orange/20 px-1 text-[9px] font-bold tracking-wider text-gf-orange"
          >
            {placementBadge(chip)}
          </span>
          {chip.operator !== undefined ? (
            <span
              data-testid="chip-operator"
              className="rounded-[1px] bg-hover px-1 text-[9px] font-bold tracking-wider text-muted"
            >
              {chip.operator}
            </span>
          ) : null}
          <span className="font-medium text-muted">{chip.label}</span>
          <span className="text-faint">=</span>
          <span
            className="max-w-[150px] truncate font-medium"
            title={chip.value}
          >
            {chip.value}
          </span>
          <button
            type="button"
            className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded-gf hover:bg-hover ${
              chip.foreign ? 'text-gf-purple' : 'text-gf-blue'
            }`}
            aria-label={`Remove filter ${chip.label}: ${chip.value}`}
            onClick={chip.remove}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex-1" />

      <button
        type="button"
        data-testid="clear-all-filters"
        className="h-6 rounded-gf px-2 text-[11px] text-muted hover:text-gf-red"
        onClick={() => topology.reset()}
      >
        Clear All
      </button>
    </div>
  );
}
