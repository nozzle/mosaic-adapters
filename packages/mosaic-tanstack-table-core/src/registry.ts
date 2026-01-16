/**
 * A generic registry for managing named strategies.
 * Used to decouple specific implementations (like Filters or Facets) from the core logic.
 *
 * Implements strict type contracts for Inputs and Outputs of strategies.
 */
import type { HistogramInput, HistogramOutput } from './facet-strategies';

export class StrategyRegistry<T> {
  private strategies = new Map<string, T>();

  constructor(defaults?: Record<string, T>) {
    if (defaults) {
      Object.entries(defaults).forEach(([key, value]) => {
        this.register(key, value);
      });
    }
  }

  /**
   * Register a new strategy.
   * @param name - The unique identifier for the strategy (e.g., 'spatial-contains').
   * @param impl - The implementation of the strategy.
   */
  register(name: string, impl: T): void {
    this.strategies.set(name, impl);
  }

  /**
   * Retrieve a strategy by name.
   * @param name - The unique identifier.
   * @returns The strategy implementation, or undefined if not found.
   */
  get(name: string): T | undefined {
    return this.strategies.get(name);
  }

  /**
   * Unregister a strategy.
   */
  unregister(name: string): void {
    this.strategies.delete(name);
  }
}

// --- Type Safety ---

/**
 * Defines the contract for a Facet Strategy.
 * Strategies must define what input options they accept and what output format they produce.
 */
export interface FacetStrategyDefinition<TInput = unknown, TOutput = unknown> {
  input: TInput;
  output: TOutput;
}

/**
 * The Central Registry for Facet Strategies.
 * This interface is intended to be augmented by consumers (Module Augmentation)
 * to add custom strategies like 'histogram', 'heatmap', etc.
 *
 * By default, includes the standard strategies provided by the core.
 */
export interface MosaicFacetRegistry {
  unique: FacetStrategyDefinition<void, Array<unknown>>;
  minmax: FacetStrategyDefinition<void, [number, number] | undefined>;
  totalCount: FacetStrategyDefinition<void, number>;
  histogram: FacetStrategyDefinition<HistogramInput, HistogramOutput>;
}

export type FacetStrategyKey = keyof MosaicFacetRegistry;

/**
 * Discriminated Union for Sidecar Requests.
 * Used by SidecarManager to strictly type requestAuxiliary calls without generic erasure.
 *
 * Iterates over the keys of the Registry to build specific request shapes.
 */
// eslint-disable-next-line unused-imports/no-unused-vars
export type SidecarRequest<TData> = {
  [K in keyof MosaicFacetRegistry]: {
    id: string;
    type: K;
    column: string;
    excludeColumnId?: string;
    // Conditionally require options if the strategy input is not void
    options: MosaicFacetRegistry[K]['input'] extends void
      ? void | undefined
      : MosaicFacetRegistry[K]['input'];
    onResult?: (result: MosaicFacetRegistry[K]['output']) => void;
  };
}[keyof MosaicFacetRegistry];
