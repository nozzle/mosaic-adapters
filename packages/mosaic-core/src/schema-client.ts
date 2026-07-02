import { Store } from '@tanstack/store';
import { queryFieldInfo } from '@uwdata/mosaic-core';
import type { Coordinator, FieldInfo, Stat } from '@uwdata/mosaic-core';
import type { DataClientStatus } from './types';

export interface SchemaClientOptions {
  coordinator: Coordinator;
  table: string;
  /**
   * Columns to describe. '*' (default) describes every column of the table
   * (types and nullability, no stats).
   */
  columns?: '*' | Array<string>;
  /**
   * Summary statistics fetched per column ('count' | 'nulls' | 'min' |
   * 'max' | 'distinct'). Ignored for `columns: '*'` — upstream resolves that
   * through a plain DESCRIBE.
   */
  stats?: Array<Stat>;
}

export interface SchemaClientState {
  status: DataClientStatus;
  error: Error | null;
  fields: Array<FieldInfo>;
}

export interface SchemaClient {
  readonly store: Store<SchemaClientState>;
  /** Re-run the field-info queries (e.g. after replacing the table). */
  refetch: () => Promise<void>;
  destroy: () => void;
  /** True once `destroy()` has run; destroyed clients never update again. */
  readonly destroyed: boolean;
}

/**
 * Read-once schema discovery over upstream `queryFieldInfo`: column names,
 * SQL/JS types, nullability, and optional summary stats — the inputs for
 * column-def generation and facet/histogram domain inference. Not a
 * `MosaicClient`: schema is not Selection-reactive; call `refetch()` if the
 * table itself changes.
 */
export function createSchemaClient(options: SchemaClientOptions): SchemaClient {
  const store = new Store<SchemaClientState>({
    status: 'pending',
    error: null,
    fields: [],
  });

  let destroyed = false;
  let generation = 0;

  const fetchFields = async (): Promise<void> => {
    generation += 1;
    const current = generation;
    store.setState((prev) => ({ ...prev, status: 'pending' }));

    const columns = options.columns ?? '*';
    const requests =
      columns === '*'
        ? [{ table: options.table, column: '*' as const }]
        : columns.map((column) => ({
            table: options.table,
            column,
            stats: options.stats,
          }));

    try {
      const fields = await queryFieldInfo(options.coordinator, requests);
      if (destroyed || current !== generation) {
        return;
      }
      store.setState(() => ({ status: 'success', error: null, fields }));
    } catch (error) {
      if (destroyed || current !== generation) {
        return;
      }
      store.setState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    }
  };

  void fetchFields();

  return {
    store,
    refetch: () => {
      if (destroyed) {
        return Promise.resolve();
      }
      return fetchFields();
    },
    destroy: () => {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}
