import { MosaicClient } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import { SqlIdentifier } from './domain/sql-identifier';
import {
  createClearClause,
  createSubqueryClause,
  createValueClause,
} from './clause-factory';
import {
  buildSubqueryPredicate,
  normalizeSubqueryFilterQuery,
} from './subquery-predicate';
import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import type { SubqueryFilterQuery } from './subquery-predicate';
import type { FilterInput, FilterMode } from './types';

type FilterValueFor<TMode extends FilterMode> = Extract<
  FilterInput,
  { mode: TMode }
>['value'];

/**
 * Builds the membership subquery for a SUBQUERY-mode filter from the
 * filter's current value. Must be pure: it re-runs on every apply.
 */
export type MosaicFilterSubqueryFactory<TValue = unknown> = (
  value: TValue,
) => SubqueryFilterQuery;

export type MosaicFilterOptions<TMode extends FilterMode> = {
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
} & (TMode extends 'SUBQUERY'
  ? {
      /**
       * Builds the membership subquery from the filter value. Required for
       * SUBQUERY mode; the predicate becomes `column [NOT] IN (<query>)`.
       */
      subquery: MosaicFilterSubqueryFactory<FilterValueFor<TMode>>;
    }
  : {
      subquery?: never;
    });

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
  // Stored with a widened value type; the public options type enforces the
  // strict pairing between TMode and the factory's value parameter.
  private subqueryFactory: MosaicFilterSubqueryFactory | undefined;

  constructor(options: MosaicFilterOptions<TMode>) {
    super(options.selection);
    this.selection = options.selection;
    this.column = options.column;
    this.mode = options.mode;
    this.debounceTime = options.debounceTime ?? 300;
    this.filterId = options.id || `filter-${options.column}`;
    this.subqueryFactory = options.subquery as
      | MosaicFilterSubqueryFactory
      | undefined;
  }

  /**
   * Replaces the subquery factory used by SUBQUERY mode. Useful when the
   * factory closes over changing state (e.g. inline lambdas in UI code).
   * Does not re-apply the current value.
   */
  public updateSubquery(
    subquery: MosaicFilterSubqueryFactory<FilterValueFor<TMode>>,
  ): void {
    this.subqueryFactory = subquery as MosaicFilterSubqueryFactory;
  }

  /**
   * Sets the filter value. Triggers debounce.
   * Strictly typed to match the Filter Mode.
   */
  public setValue(value: FilterValueFor<TMode>) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.apply(value);
    }, this.debounceTime);
  }

  /**
   * Immediate update (bypassing debounce).
   */
  public apply(value: FilterValueFor<TMode>) {
    const predicate = this.generatePredicate(value);
    const spec = {
      source: this,
      value: value,
      predicate,
    };

    // Subquery predicates must never carry optimizer `meta`; route them
    // through the dedicated clause constructor.
    this.selection.update(
      this.mode === 'SUBQUERY'
        ? createSubqueryClause(spec)
        : createValueClause(spec),
    );
  }

  /**
   * Cleans up the filter state.
   */
  public dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.selection.update(createClearClause(this));
  }

  private generatePredicate(
    value: FilterValueFor<TMode>,
  ): SelectionClause['predicate'] {
    if (value === undefined || value === '') {
      return null;
    }

    const colExpr = createStructAccess(SqlIdentifier.from(this.column));
    // Widen to the full mode union so the switch stays exhaustive: adding a
    // new FilterInput mode is a compile-driven change here.
    const mode: FilterMode = this.mode;

    switch (mode) {
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

      case 'SUBQUERY': {
        if (!this.subqueryFactory) {
          return null;
        }

        const normalized = normalizeSubqueryFilterQuery(
          this.subqueryFactory(value),
        );

        if (!normalized) {
          return null;
        }

        return buildSubqueryPredicate({
          column: this.column,
          query: normalized.query,
          negate: normalized.negate,
        });
      }

      case 'CONDITION': {
        // CONDITION filters are resolved by the filter-builder / table filter
        // strategies, not by this controller.
        return null;
      }

      default: {
        const exhaustive: never = mode;
        return exhaustive;
      }
    }
  }
}
