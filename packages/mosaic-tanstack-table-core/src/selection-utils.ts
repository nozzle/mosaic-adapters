import { MosaicSelectionManager } from './selection-manager';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { ColumnType } from './types';

export interface ToggleSelectionOptions<TValue = unknown> {
  /**
   * The Mosaic Selection instance to update.
   */
  selection: Selection;
  /**
   * The Mosaic Client performing the update.
   * Required to identify the source and properly configure cross-filtering (exclude self).
   */
  client: MosaicClient;
  /**
   * The column name (or path) to filter on.
   */
  column: string;
  /**
   * The value to toggle.
   * Pass `null` to clear the selection for this client.
   */
  value: TValue | null;
  /**
   * The type of the column.
   * @default 'scalar'
   */
  columnType?: ColumnType;
}

/**
 * A helper to robustly toggle selection values for a Mosaic Client.
 * DELEGATES to MosaicSelectionManager for unified logic.
 * Handles:
 * - Reading current state from the Selection
 * - Toggling values (Add/Remove)
 * - Constructing correct SQL Predicates (EQ, IN, LIST_HAS_ANY)
 * - Handling nested column paths (struct access)
 * - dispatching updates with the correct `clients` set for cross-filtering
 */
export function toggleMosaicSelection<TValue = unknown>(
  options: ToggleSelectionOptions<TValue>,
): void {
  // Ephemeral manager to handle the toggle logic via the standard class
  const manager = new MosaicSelectionManager<TValue>({
    selection: options.selection,
    client: options.client,
    column: options.column,
    columnType: options.columnType,
  });

  manager.toggle(options.value);
}
