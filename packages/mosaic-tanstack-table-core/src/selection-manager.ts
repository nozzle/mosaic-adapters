// packages/mosaic-tanstack-table-core/src/selection-manager.ts

import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { ColumnType } from './types';

export interface SelectionManagerOptions {
  /** The Mosaic Selection to manage */
  selection: Selection;
  /** The Client instance acting as the source of truth */
  client: MosaicClient;
  /** The SQL column name (or path) */
  column: string;
  /**
   * The type of the column.
   * @default 'scalar'
   */
  columnType?: ColumnType;
}

/**
 * Manages the lifecycle of a Mosaic Selection for a specific client and column.
 * Handles reading current state, toggling values, and generating the correct SQL predicates.
 */
export class MosaicSelectionManager {
  private selection: Selection;
  private client: MosaicClient;
  private column: string;
  private columnType: ColumnType;

  constructor(options: SelectionManagerOptions) {
    this.selection = options.selection;
    this.client = options.client;
    this.column = options.column;
    this.columnType = options.columnType ?? 'scalar';
  }

  /**
   * Toggles a value.
   * - If value is null, clears selection.
   * - If value exists, removes it.
   * - If value is new, adds it.
   */
  public toggle(value: any): void {
    if (value === null) {
      this.update(null);
      return;
    }

    const current = this.getCurrentValues();
    const newValues = [...current];

    // Simple existence check (can be expanded for objects later)
    const idx = newValues.indexOf(value);

    if (idx >= 0) {
      newValues.splice(idx, 1);
    } else {
      newValues.push(value);
    }

    this.update(newValues.length > 0 ? newValues : null);
  }

  /**
   * Sets the selection to a specific set of values.
   */
  public select(values: Array<any> | any | null): void {
    if (values === null) {
      this.update(null);
      return;
    }
    const newValues = Array.isArray(values) ? values : [values];
    this.update(newValues.length > 0 ? newValues : null);
  }

  /**
   * Reads the current selection state from the Mosaic Core.
   */
  public getCurrentValues(): Array<any> {
    const raw = this.selection.valueFor(this.client);
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw !== null && raw !== undefined) {
      return [raw];
    }
    return [];
  }

  /**
   * Internal method to generate SQL and push update.
   */
  private update(values: Array<any> | null): void {
    let predicate: FilterExpr | null = null;

    if (values && values.length > 0) {
      const colExpr = createStructAccess(this.column);

      if (this.columnType === 'array') {
        // list_has_any(col, ['val1', 'val2'])
        // Fix: mSql.literal(values) fails for arrays (stringifies to "a,b").
        // Fix 2: mSql.sql`[${array}]` fails Typescript check (TemplateValue not Array).
        // Solution: Manually construct the comma-separated list expression via reduce.
        const listContent = values.slice(1).reduce((acc, v) => {
          return mSql.sql`${acc}, ${mSql.literal(v)}`;
        }, mSql.literal(values[0]));

        const listLiteral = mSql.sql`[${listContent}]`;
        predicate = mSql.listHasAny(colExpr, listLiteral);
      } else {
        if (values.length === 1) {
          // col = 'val'
          predicate = mSql.eq(colExpr, mSql.literal(values[0]));
        } else {
          // col IN ('val1', 'val2')
          predicate = mSql.isIn(
            colExpr,
            values.map((v) => mSql.literal(v)),
          );
        }
      }
    }

    this.selection.update({
      source: this.client,
      // Critical: Exclude self from the filter so menus/tables don't filter themselves empty
      clients: new Set([this.client]),
      value: values,
      predicate: predicate!,
    });
  }
}
