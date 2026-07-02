import { BaseDataClient } from './base-client';
import { toResultRows } from './utils';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type {
  QueryContext,
  ValuesClient,
  ValuesClientOptions,
  ValuesClientState,
  ValuesInputs,
} from './types';

/**
 * Single-row aggregate query → typed record. One round trip serves any
 * number of KPI cards: every selected column becomes a field of `values`.
 */
export function createValuesClient<TValues extends Record<string, unknown>>(
  options: ValuesClientOptions,
): ValuesClient<TValues> {
  return new ValuesDataClient<TValues>(options);
}

class ValuesDataClient<TValues extends Record<string, unknown>>
  extends BaseDataClient<ValuesInputs, ValuesClientState<TValues>>
  implements ValuesClient<TValues>
{
  constructor(options: ValuesClientOptions) {
    super(options, options.query, { values: undefined });
  }

  protected buildQuery(ctx: QueryContext<ValuesInputs>): SelectQuery {
    return this.resolveBase(ctx);
  }

  protected onResult(data: unknown): Partial<ValuesClientState<TValues>> {
    const rows = toResultRows(data);
    const first = rows[0];
    if (first === undefined) {
      return { values: undefined };
    }
    return { values: { ...first } as TValues };
  }
}
