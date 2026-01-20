import { Store } from '@tanstack/store';
import type { Selection } from '@uwdata/mosaic-core';

/**
 * Configuration for a logical group of filters.
 * Used to sort the display of active filters in the UI.
 */
export interface FilterGroupConfig {
  id: string;
  label: string;
  priority: number; // Lower number = higher in the list
}

/**
 * Configuration for registering a Selection with the registry.
 */
export interface SelectionRegistration {
  selection: Selection;
  groupId: string;
  /** Optional map to override labels for specific source IDs (e.g., column names) */
  labelMap?: Record<string, string>;
  /** Optional map to format values for specific source IDs */
  formatterMap?: Record<string, (val: unknown) => string>;
}

/**
 * Represents a single active filter clause ready for display.
 */
export interface ActiveFilter {
  id: string;
  groupId: string;
  sourceId: string;
  label: string;
  value: unknown;
  formattedValue: string;
  selection: Selection;
  /** The original source object that generated this filter */
  sourceObject: unknown;
  /** If this is part of a larger object (like Table Filters), identifying key */
  subId?: string;
}

/**
 * Central registry for tracking active Mosaic filters across an application.
 * Listens to registered selections and normalizes their state into a single list
 * for UI consumption.
 */
export class MosaicFilterRegistry {
  private groups = new Map<string, FilterGroupConfig>();
  private registrations = new Map<Selection, SelectionRegistration>();

  public store = new Store<{ filters: Array<ActiveFilter> }>({ filters: [] });

  /**
   * Registers a group definition.
   */
  registerGroup(config: FilterGroupConfig) {
    this.groups.set(config.id, config);
    // Trigger update to re-sort if needed, though usually groups are static
    this.handleUpdate();
  }

  /**
   * Registers a selection to be tracked.
   */
  registerSelection(selection: Selection, config: SelectionRegistration) {
    this.registrations.set(selection, config);
    selection.addEventListener('value', this.handleUpdate);
    this.handleUpdate();
  }

  /**
   * Unregisters a selection.
   */
  unregisterSelection(selection: Selection) {
    this.registrations.delete(selection);
    selection.removeEventListener('value', this.handleUpdate);
    this.handleUpdate();
  }

  /**
   * Internal handler called whenever a registered selection changes.
   * Aggregates all clauses from all selections, normalizes them, and updates the store.
   */
  private handleUpdate = () => {
    const allFilters: Array<ActiveFilter> = [];

    for (const [selection, config] of this.registrations.entries()) {
      // Access internal clauses of the selection.
      const clauses = (selection as any).clauses || [];

      clauses.forEach((clause: any) => {
        const sourceClient = clause.source;
        const rawValue = clause.value;

        // Skip empty/null values
        if (rawValue === null || rawValue === undefined) {
          return;
        }

        // --- Logic to resolve Source ID ---
        let sourceId = 'unknown';

        if (sourceClient) {
          if (sourceClient.rowSelectionColumn) {
            // Case: MosaicDataTable (Summary Row Selection)
            sourceId = sourceClient.rowSelectionColumn;
          } else if (sourceClient.column) {
            // Case: MosaicFacetMenu or similar
            sourceId = sourceClient.column;
          } else if (sourceClient.options?.column) {
            sourceId = sourceClient.options.column;
          } else if (sourceClient.debugName) {
            sourceId = sourceClient.debugName;
          }
        }

        // --- Logic to explode TanStack Filter Arrays (Detail Table) ---
        // Heuristic: Array of objects with { id, value }
        const isTanStackFilterArray =
          Array.isArray(rawValue) &&
          rawValue.length > 0 &&
          typeof rawValue[0] === 'object' && // Check if item is object (Fix for "Cannot use 'in' operator")
          rawValue[0] !== null &&
          'id' in rawValue[0] &&
          'value' in rawValue[0];

        if (isTanStackFilterArray) {
          (rawValue as Array<{ id: string; value: unknown }>).forEach(
            (item) => {
              const itemSourceId = item.id;
              const itemValue = item.value;

              this.addActiveFilter(
                allFilters,
                config,
                itemSourceId,
                itemValue,
                selection,
                sourceClient,
                itemSourceId, // subId
              );
            },
          );
        } else {
          // Standard Single Value
          this.addActiveFilter(
            allFilters,
            config,
            sourceId,
            rawValue,
            selection,
            sourceClient,
          );
        }
      });
    }

    // Sort by Group Priority
    allFilters.sort((a, b) => {
      const pA = this.groups.get(a.groupId)?.priority ?? 999;
      const pB = this.groups.get(b.groupId)?.priority ?? 999;
      return pA - pB;
    });

    this.store.setState({ filters: allFilters });
  };

  private addActiveFilter(
    list: Array<ActiveFilter>,
    config: SelectionRegistration,
    sourceId: string,
    value: unknown,
    selection: Selection,
    sourceObject: unknown,
    subId?: string,
  ) {
    let label = sourceId;

    // Apply Label Overrides
    const mappedLabel = config.labelMap?.[sourceId];
    if (mappedLabel) {
      label = mappedLabel;
    } else if (config.labelMap?.['*']) {
      label = config.labelMap['*'];
    }

    let formatted = String(value);
    const formatter = config.formatterMap?.[sourceId];

    if (formatter) {
      formatted = formatter(value);
    } else if (Array.isArray(value)) {
      // Default range/list formatting
      if (value.length === 2 && typeof value[0] === 'number') {
        formatted = `${value[0]} - ${value[1]}`;
      } else {
        formatted = value.join(', ');
      }
    } else if (value instanceof Date) {
      formatted = value.toLocaleDateString();
    } else if (typeof value === 'object') {
      // Safe stringify for complex objects that slipped through
      try {
        formatted = JSON.stringify(value);
      } catch {
        formatted = '[Complex Value]';
      }
    }

    list.push({
      id: `${config.groupId}-${sourceId}-${JSON.stringify(value)}`,
      groupId: config.groupId,
      sourceId,
      label,
      value,
      formattedValue: formatted,
      selection,
      sourceObject,
      subId,
    });
  }

  /**
   * Removes a specific filter.
   * Updates the underlying selection.
   * Supports granular removal for Table Filters by mutating the array and writing back.
   */
  removeFilter(filter: ActiveFilter) {
    if (!filter.sourceObject) {
      return;
    }

    // Check if this is a sub-filter (part of an array, like Table Column Filters)
    if (filter.subId && Array.isArray((filter.selection as any).value)) {
      const currentVal = (filter.selection as any).value as Array<{
        id: string;
        value: unknown;
      }>;
      // Filter out the specific item
      const nextVal = currentVal.filter((item) => item.id !== filter.subId);

      filter.selection.update({
        source: filter.sourceObject as object,
        value: nextVal, // Write back the modified array
        predicate: null, // Let the source (Table) regenerate the predicate internally if needed, or pass null to force a refresh cycle
      });
    } else {
      // Standard clearing
      filter.selection.update({
        source: filter.sourceObject as object,
        value: null,
        predicate: null,
      });
    }
  }

  /**
   * Clears all filters for a specific group.
   */
  clearGroup(groupId: string) {
    const filters = this.store.state.filters.filter(
      (f) => f.groupId === groupId,
    );
    filters.forEach((f) => this.removeFilter(f));
  }
}
