import type { Selection } from '@uwdata/mosaic-core';
import { Store } from '@tanstack/store';

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
}

/**
 * Central registry for tracking active Mosaic filters across an application.
 * Listens to registered selections and normalizes their state into a single list
 * for UI consumption.
 */
export class MosaicFilterRegistry {
  private groups = new Map<string, FilterGroupConfig>();
  private registrations = new Map<Selection, SelectionRegistration>();

  public store = new Store<{ filters: ActiveFilter[] }>({ filters: [] });

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
    const allFilters: ActiveFilter[] = [];

    for (const [selection, config] of this.registrations.entries()) {
      // Access internal clauses of the selection.
      // Note: In standard Mosaic usage, 'clauses' is where the active state lives.
      const clauses = (selection as any).clauses || [];

      clauses.forEach((clause: any) => {
        const sourceClient = clause.source;
        const rawValue = clause.value;

        // Skip empty/null values
        if (rawValue === null || rawValue === undefined) {
          return;
        }

        // 1. Resolve Source ID and Label
        let label = 'Unknown Filter';
        let sourceId = 'unknown';

        if (sourceClient) {
          // Attempt to extract column info or debug name
          // Check for 'column' property which exists on most Mosaic clients/filters
          if (sourceClient.column) {
            sourceId = sourceClient.column;
            label = sourceId;
          } else if (sourceClient.options?.column) {
            sourceId = sourceClient.options.column;
            label = sourceId;
          } else if (sourceClient.debugName) {
            label = sourceClient.debugName;
          }
        }

        // Apply Label Overrides
        const mappedLabel = config.labelMap?.[sourceId];
        if (mappedLabel) {
          label = mappedLabel;
        } else if (config.labelMap?.['*']) {
          // specific fallback if needed, or simple default behavior above
          label = config.labelMap['*'];
        }

        // 2. Format Value
        let formatted = String(rawValue);

        const formatter = config.formatterMap?.[sourceId];
        if (formatter) {
          formatted = formatter(rawValue);
        } else if (Array.isArray(rawValue)) {
          // Default range/list formatting
          if (rawValue.length === 2 && typeof rawValue[0] === 'number') {
            formatted = `${rawValue[0]} - ${rawValue[1]}`;
          } else {
            formatted = rawValue.join(', ');
          }
        } else if (rawValue instanceof Date) {
          formatted = rawValue.toLocaleDateString();
        }

        allFilters.push({
          id: `${config.groupId}-${sourceId}-${JSON.stringify(rawValue)}`,
          groupId: config.groupId,
          sourceId,
          label,
          value: rawValue,
          formattedValue: formatted,
          selection,
          sourceObject: sourceClient,
        });
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

  /**
   * Removes a specific filter.
   * Updates the underlying selection by setting the value for the specific source to null.
   */
  removeFilter(filter: ActiveFilter) {
    if (filter.sourceObject) {
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