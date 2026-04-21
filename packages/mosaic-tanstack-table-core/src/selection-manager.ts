import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import { SqlIdentifier } from './domain/sql-identifier';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { ColumnType, PrimitiveSqlValue } from './types';

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
 *
 * @template TValue - The type of value being managed (e.g., string, number, Date).
 */
export class MosaicSelectionManager<
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
> {
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

  private normalizeSelectionValues(raw: unknown): Array<TValue> | null {
    if (Array.isArray(raw)) {
      return raw as Array<TValue>;
    }

    if (raw === null || raw === undefined) {
      return [];
    }

    if (
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean' ||
      raw instanceof Date
    ) {
      return [raw as TValue];
    }

    return null;
  }

  /**
   * Toggles a value.
   * - If value is null, clears selection.
   * - If value exists, removes it.
   * - If value is new, adds it.
   */
  public toggle(value: TValue | null): void {
    if (value === null) {
      this.update(null);
      return;
    }

    const current = this.getCurrentValues();
    const newValues = [...current];

    // Simple existence check (can be expanded for objects later if TValue requires it)
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
  public select(values: Array<TValue> | TValue | null): void {
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
  public getCurrentValues(): Array<TValue> {
    return (
      this.normalizeSelectionValues(this.selection.valueFor(this.client)) ?? []
    );
  }

  /**
   * Reads the selection value without source scoping.
   * This keeps remounted clients in sync when a shared Selection is reused
   * across different table instances, such as fullscreen/table swaps.
   */
  public getSharedValues(): Array<TValue> {
    const sharedValues = this.normalizeSelectionValues(this.selection.value);
    if (sharedValues !== null) {
      return sharedValues;
    }

    return this.getCurrentValues();
  }

  /**
   * Internal method to generate SQL and push update.
   */
  private update(values: Array<TValue> | null): void {
    let predicate: FilterExpr | null = null;

    if (values && values.length > 0) {
      const colExpr = createStructAccess(SqlIdentifier.from(this.column));

      if (this.columnType === 'array') {
        // list_has_any(col, ['val1', 'val2'])
        // Manually construct the comma-separated list expression via reduce.
        const [firstValue, ...rest] = values;
        if (firstValue === undefined) {
          return;
        }

        const listContent = rest.reduce<
          ReturnType<typeof mSql.literal> | ReturnType<typeof mSql.sql>
        >((acc, v) => {
          return mSql.sql`${acc}, ${mSql.literal(v)}`;
        }, mSql.literal(firstValue));

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
      predicate,
    });
  }
}
