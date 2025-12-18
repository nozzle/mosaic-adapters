// packages/mosaic-tanstack-table-core/src/selection-utils.ts

import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';

export interface ToggleSelectionOptions {
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
  value: any;
  /**
   * Whether the column contains array data (requiring `list_has_any` logic).
   * @default false
   */
  isArrayColumn?: boolean;
}

/**
 * A helper to robustly toggle selection values for a Mosaic Client.
 * Handles:
 * - Reading current state from the Selection
 * - Toggling values (Add/Remove)
 * - Constructing correct SQL Predicates (EQ, IN, LIST_HAS_ANY)
 * - Handling nested column paths (struct access)
 * - dispatching updates with the correct `clients` set for cross-filtering
 */
export function toggleMosaicSelection({
  selection,
  client,
  column,
  value,
  isArrayColumn = false,
}: ToggleSelectionOptions): void {
  // 1. Handle "Clear All"
  if (value === null) {
    selection.update({
      source: client,
      clients: new Set([client]),
      value: null,
      predicate: null,
    });
    return;
  }

  // 2. Get Current Selection State
  const current = selection.valueFor(client);
  let newValues: Array<any> = [];

  if (Array.isArray(current)) {
    newValues = [...current];
  } else if (current !== null && current !== undefined) {
    newValues = [current];
  }

  // 3. Toggle Logic
  // Check existence. For primitives this works fine.
  const idx = newValues.indexOf(value);
  if (idx >= 0) {
    newValues.splice(idx, 1);
  } else {
    newValues.push(value);
  }

  // 4. Construct Update
  if (newValues.length === 0) {
    // If empty after toggle, clear it
    selection.update({
      source: client,
      clients: new Set([client]),
      value: null,
      predicate: null,
    });
  } else {
    const colExpr = createStructAccess(column);
    let predicate: FilterExpr;

    if (isArrayColumn) {
      // For Arrays: list_has_any(col, ['val1', 'val2'])
      // We wrap the entire array in mSql.literal so it becomes a DuckDB List Literal.
      predicate = mSql.listHasAny(colExpr, mSql.literal(newValues));
    } else {
      if (newValues.length === 1) {
        // Optimization: Single EQ
        predicate = mSql.eq(colExpr, mSql.literal(newValues[0]));
      } else {
        // Multi-Select: IN clause
        // We MUST wrap values in mSql.literal() or they are treated as Identifiers
        predicate = mSql.isIn(
          colExpr,
          newValues.map((v) => mSql.literal(v)),
        );
      }
    }

    selection.update({
      source: client,
      clients: new Set([client]),
      value: newValues,
      predicate: predicate,
    });
  }
}
