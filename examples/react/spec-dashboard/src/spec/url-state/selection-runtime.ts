/** Runtime bridge between app-owned selection URL descriptors and Mosaic. */
import { clauseInterval } from '@uwdata/mosaic-core';
import { SqlIdentifier, createStructAccess } from '@nozzleio/react-mosaic';
import { decodeNumericInterval, encodeNumericInterval } from './selection-url';
import type { ActiveClause, Topology } from '@nozzleio/react-mosaic';
import type { Search } from '@/router';
import type { SelectionUrlRegistry } from './selection-url';

/** Entries that have held a valid runtime value during this topology lifetime. */
export interface SelectionWriteState {
  activeEntries: Set<string>;
}

export function createSelectionWriteState(): SelectionWriteState {
  return { activeEntries: new Set() };
}

/**
 * Seed persisted standalone selections before the topology reaches widgets.
 * Invalid values are ignored and deliberately left in the URL: this app does
 * not claim a hand-edited value until that entry has produced valid state.
 */
export function hydratePersistedSelections(
  topology: Topology,
  registry: SelectionUrlRegistry,
  search: Search,
): void {
  for (const descriptor of registry.entries) {
    const raw = search[descriptor.param];
    if (raw === undefined) {
      continue;
    }
    const value = decodeNumericInterval(raw);
    if (value === null) {
      continue;
    }
    topology.resolve(descriptor.ref).update(
      clauseInterval(
        createStructAccess(SqlIdentifier.from(descriptor.column)),
        value,
        {
          // One stable source object for this restored clause. A renderer may
          // later displace it through the entry's `single` strategy.
          source: {},
        },
      ),
    );
  }
}

/**
 * Encode the complete live standalone-selection domain as a router patch.
 *
 * A missing entry is deleted only after it has held a valid value in this
 * topology lifetime. That preserves unknown/malformed incoming values until
 * the app has actually taken ownership of the corresponding entry.
 */
export function buildSelectionUrlPatch(
  registry: SelectionUrlRegistry,
  activeClauses: ReadonlyArray<ActiveClause>,
  state: SelectionWriteState,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const descriptor of registry.entries) {
    const active = activeClauses.find(
      (candidate) => candidate.ref === descriptor.ref,
    );
    const encoded = encodeNumericInterval(active?.clause.value);
    if (encoded !== null) {
      state.activeEntries.add(descriptor.entry);
      patch[descriptor.param] = encoded;
      continue;
    }
    if (state.activeEntries.has(descriptor.entry)) {
      patch[descriptor.param] = null;
    }
  }
  return patch;
}
