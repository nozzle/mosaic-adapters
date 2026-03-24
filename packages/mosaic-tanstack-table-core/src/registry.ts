/**
 * A generic registry for managing named strategies.
 * Used to decouple specific implementations (like Filters or Facets) from the core logic.
 *
 * Implements strict type contracts for Inputs and Outputs of strategies.
 */
import type {
  FacetStrategy,
  HistogramInput,
  HistogramOutput,
} from './facet-strategies';

export class StrategyRegistry<TStrategies extends Record<string, unknown>> {
  private strategies = new Map<
    keyof TStrategies,
    TStrategies[keyof TStrategies]
  >();

  constructor(defaults?: Partial<TStrategies>) {
    if (defaults) {
      Object.entries(defaults).forEach(([key, value]) => {
        if (value === undefined) {
          return;
        }
        this.register(
          key as keyof TStrategies,
          value as TStrategies[keyof TStrategies],
        );
      });
    }
  }

  /**
   * Register a new strategy.
   * @param name - The unique identifier for the strategy (e.g., 'spatial-contains').
   * @param impl - The implementation of the strategy.
   */
  register<TKey extends keyof TStrategies>(
    name: TKey,
    impl: TStrategies[TKey],
  ): void {
    this.strategies.set(name, impl);
  }

  /**
   * Retrieve a strategy by name.
   * @param name - The unique identifier.
   * @returns The strategy implementation, or undefined if not found.
   */
  get<TKey extends keyof TStrategies>(
    name: TKey,
  ): TStrategies[TKey] | undefined {
    return this.strategies.get(name) as TStrategies[TKey] | undefined;
  }

  /**
   * Unregister a strategy.
   */
  unregister<TKey extends keyof TStrategies>(name: TKey): void {
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
export type FacetStrategyKeyWithoutInput = {
  [K in FacetStrategyKey]: MosaicFacetRegistry[K]['input'] extends void
    ? K
    : never;
}[FacetStrategyKey];

export type FacetStrategyMap = {
  [K in FacetStrategyKey]: FacetStrategy<
    MosaicFacetRegistry[K]['input'],
    MosaicFacetRegistry[K]['output']
  >;
};

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
