import { SidecarClient } from './sidecar-client';
import type { FacetStrategy } from './facet-strategies';
import type { SidecarConfig } from './sidecar-client';

/**
 * Creates a strongly-typed SidecarClient class for a specific Strategy.
 * Enforces that the constructor options match the Strategy's TInput requirement.
 *
 * FIX: Explicitly annotates the return type to avoid TS4094 errors regarding
 * private members in exported anonymous classes.
 */
export function createTypedSidecarClient<TInput, TOutput>(
  strategy: FacetStrategy<TInput, TOutput>,
): new (
  config: Omit<SidecarConfig<TInput, TOutput>, 'options'> & {
    options: TInput extends void ? void | undefined : TInput;
  },
) => SidecarClient<TInput, TOutput> {
  // Define the strict config type based on TInput
  type TypedConfig = Omit<SidecarConfig<TInput, TOutput>, 'options'> & {
    options: TInput extends void ? void | undefined : TInput;
  };

  class TypedSidecar extends SidecarClient<TInput, TOutput> {
    constructor(config: TypedConfig) {
      // Nest options inside an 'options' property so they are spread correctly into ctx.options.
      // SidecarClient spreads `config.options` into the context.
      // FacetQueryContext expects `options: TInput`.
      // Therefore, we must pass `{ options: config.options }`.
      super(
        { ...config, options: { options: config.options } as any },
        strategy,
      );
    }
  }

  return TypedSidecar;
}
