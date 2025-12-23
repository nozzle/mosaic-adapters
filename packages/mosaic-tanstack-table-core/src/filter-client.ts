import { MosaicClient } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import type { Selection } from '@uwdata/mosaic-core';

export type FilterMode = 'TEXT' | 'MATCH' | 'RANGE' | 'DATE_RANGE';

export interface MosaicFilterOptions {
  /** The selection instance to update */
  selection: Selection;
  /** The SQL column name (or struct path "a.b") */
  column: string;
  /** Filter mode */
  mode?: FilterMode;
  /** Debounce delay in ms. Default 300. */
  debounceTime?: number;
  /** Optional ID for the selection clause */
  id?: string;
}

/**
 * A headless controller for managing filter inputs.
 * Handles debouncing and SQL generation logic.
 * Extends MosaicClient to participate in the Selection topology as a valid source.
 */
export class MosaicFilter extends MosaicClient {
  private selection: Selection;
  public column: string;
  public mode: FilterMode;
  public debounceTime: number;
  public filterId: string;

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MosaicFilterOptions) {
    super(options.selection);
    this.selection = options.selection;
    this.column = options.column;
    this.mode = options.mode || 'TEXT';
    this.debounceTime = options.debounceTime ?? 300;
    this.filterId = options.id || `filter-${options.column}`;
  }

  /**
   * Sets the filter value. Triggers debounce.
   */
  public setValue(value: any) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.apply(value);
    }, this.debounceTime);
  }

  /**
   * Immediate update (bypassing debounce).
   * Renamed from 'update' to 'apply' to avoid conflict with MosaicClient base class.
   */
  public apply(value: any) {
    const predicate = this.generatePredicate(value);

    this.selection.update({
      source: this,
      value: value,
      predicate: predicate as any,
    });
  }

  /**
   * Cleans up the filter state.
   * Removes the corresponding clause from the selection.
   */
  public dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    // Remove this filter's effect from the selection
    this.selection.update({
      source: this,
      value: null,
      predicate: null,
    });
  }

  private generatePredicate(value: any): mSql.FilterExpr | null {
    // 1. Handle Empty States
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const colExpr = createStructAccess(this.column);

    // 2. Generate SQL based on Mode
    switch (this.mode) {
      case 'TEXT': {
        // ILIKE '%value%'
        return mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + value + '%')}`;
      }

      case 'MATCH': {
        // Exact Match: col = 'value'
        return mSql.eq(colExpr, mSql.literal(value));
      }

      case 'DATE_RANGE':
      case 'RANGE': {
        // Expects value to be [min, max] or {start, end} logic handled by caller usually
        // But let's assume we receive [start, end]
        if (Array.isArray(value)) {
          const [start, end] = value;
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

      default:
        return null;
    }
  }
}
