/**
 * A reactive bridge component that translates filters from one aggregation level to another.
 * Used for "Cross-Filtering Aggregations" where a summary table filters a detail table via a subquery.
 */

import type { Selection } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';

export interface AggregationBridgeOptions {
  /** Identity source for cross-filtering */
  source: object;
  /** The selection driving the change (e.g. Summary Table Filters like "Count > 500") */
  inputSelection: Selection;
  /** The global context to respect (e.g. Map Brush, Vendor) */
  contextSelection: Selection;
  /** The selection to update with the resolved predicate (e.g. Zone Filter) */
  outputSelection: Selection;
  /**
   * Pure function to generate the SQL Predicate.
   * @param inputPredicate - The WHERE clause from the input selection.
   * @param contextPredicate - The WHERE clause from the context selection.
   */
  resolve: (
    inputPredicate: FilterExpr | null,
    contextPredicate: FilterExpr | null,
  ) => FilterExpr | null;
}

export class AggregationBridge {
  private options: AggregationBridgeOptions;

  constructor(options: AggregationBridgeOptions) {
    this.options = options;
  }

  /**
   * Main logic: Reads inputs, runs resolve, updates output.
   */
  public update = () => {
    const {
      inputSelection,
      contextSelection,
      outputSelection,
      resolve,
      source,
    } = this.options;

    // 1. Get Predicates
    // We pass null to predicate() to get the "Global Truth" from that selection
    const inputPred = inputSelection.predicate(null) || null;
    const contextPred = contextSelection.predicate(null) || null;

    // Optimization: If no input filters, clear the bridge to avoid expensive subqueries
    // We assume that if the input (summary filter) is empty, we don't want to filter the output.
    // NOTE: We check toString() because sometimes empty predicates are not null but "true".
    if (!inputPred || inputPred.toString() === 'true') {
      // Only clear if not already empty to avoid loops
      if (outputSelection.value !== null) {
        outputSelection.update({
          source,
          value: null,
          predicate: null,
        });
      }
      return;
    }

    // 2. Resolve Logic
    const resultPredicate = resolve(
      inputPred as FilterExpr,
      contextPred as FilterExpr,
    );

    // 3. Update Output
    outputSelection.update({
      source,
      value: 'custom', // Arbitrary value, we rely on the predicate
      predicate: resultPredicate as any,
    });
  };

  /**
   * Subscribes to input selections.
   * @returns Unsubscribe function.
   */
  public connect(): () => void {
    const { inputSelection, contextSelection } = this.options;

    inputSelection.addEventListener('value', this.update);
    contextSelection.addEventListener('value', this.update);

    // Run once on connect to sync state
    this.update();

    return () => {
      inputSelection.removeEventListener('value', this.update);
      contextSelection.removeEventListener('value', this.update);
    };
  }
}
