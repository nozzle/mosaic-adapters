import { SidecarClient } from './sidecar-client';
import type { FacetStrategy } from './facet-strategies';
import type { SidecarConfig } from './sidecar-client';

type TypedSidecarConfig<TInput, TOutput> = Omit<
  SidecarConfig<TInput, TOutput>,
  'query'
> &
  ([TInput] extends [void] ? { options?: undefined } : { options: TInput });

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
  config: TypedSidecarConfig<TInput, TOutput>,
) => SidecarClient<TInput, TOutput> {
  class TypedSidecar extends SidecarClient<TInput, TOutput> {
    constructor(config: TypedSidecarConfig<TInput, TOutput>) {
      super(
        {
          ...config,
          query: {
            options: config.options,
          },
        },
        strategy,
      );
    }
  }

  return TypedSidecar;
}
