import { MosaicClient } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import { SqlIdentifier } from './domain/sql-identifier';
import type { Selection } from '@uwdata/mosaic-core';
import type { FilterInput, FilterMode } from './types';

export interface MosaicFilterOptions<TMode extends FilterMode> {
  /** The selection instance to update */
  selection: Selection;
  /** The SQL column name (or struct path "a.b") */
  column: string;
  /** Filter mode */
  mode: TMode;
  /** Debounce delay in ms. Default 300. */
  debounceTime?: number;
  /** Optional ID for the selection clause */
  id?: string;
}

/**
 * A headless controller for managing filter inputs.
 * Handles debouncing and SQL generation logic.
 * Enforces strict input types based on the filter mode.
 */
export class MosaicFilter<TMode extends FilterMode> extends MosaicClient {
  private selection: Selection;
  public column: string;
  public mode: TMode;
  public debounceTime: number;
  public filterId: string;

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MosaicFilterOptions<TMode>) {
    super(options.selection);
    this.selection = options.selection;
    this.column = options.column;
    this.mode = options.mode;
    this.debounceTime = options.debounceTime ?? 300;
    this.filterId = options.id || `filter-${options.column}`;
  }

  /**
   * Sets the filter value. Triggers debounce.
   * Strictly typed to match the Filter Mode.
   */
  public setValue(value: Extract<FilterInput, { mode: TMode }>['value']) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      // Fixed: Cast value as any because TS distribution logic struggles with Extract types across method calls,
      // but it is type-safe due to the Class Generic enforcement at the entry point.
      this.apply(value as any);
    }, this.debounceTime);
  }

  /**
   * Immediate update (bypassing debounce).
   */
  public apply(value: Extract<FilterInput, { mode: TMode }>['value']) {
    const predicate = this.generatePredicate(value);

    this.selection.update({
      source: this,
      value: value,
      predicate: predicate as any,
    });
  }

  /**
   * Cleans up the filter state.
   */
  public dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.selection.update({
      source: this,
      value: null,
      predicate: null,
    });
  }

  private generatePredicate(value: any): mSql.FilterExpr | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const colExpr = createStructAccess(SqlIdentifier.from(this.column));

    switch (this.mode) {
      case 'TEXT': {
        return mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + value + '%')}`;
      }

      case 'MATCH': {
        return mSql.eq(colExpr, mSql.literal(value));
      }

      case 'SELECT': {
        return mSql.eq(colExpr, mSql.literal(value));
      }

      case 'DATE_RANGE': {
        if (Array.isArray(value)) {
          const [start, end] = value;
          // Handle Open Ranges
          if (start && end) {
            return mSql.isBetween(colExpr, [
              mSql.literal(start),
              mSql.literal(end),
            ]);
          } else if (start) {
            return mSql.gte(colExpr, mSql.literal(start));
          } else if (end) {
            return mSql.lte(colExpr, mSql.literal(end));
          }
        }
        return null;
      }

      case 'RANGE': {
        if (Array.isArray(value)) {
          const [min, max] = value;
          const hasMin = typeof min === 'number' && !isNaN(min);
          const hasMax = typeof max === 'number' && !isNaN(max);

          // Handle Open Ranges
          if (hasMin && hasMax) {
            return mSql.isBetween(colExpr, [
              mSql.literal(min),
              mSql.literal(max),
            ]);
          } else if (hasMin) {
            return mSql.gte(colExpr, mSql.literal(min));
          } else if (hasMax) {
            return mSql.lte(colExpr, mSql.literal(max));
          }
        }
        return null;
      }

      default:
        return null;
    }
  }
}
