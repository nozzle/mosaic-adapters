// packages/mosaic-tanstack-core/src/mosaic.ts
// This file contains the core data lifecycle logic for the Mosaic client portion
// of the DataTable. It translates Tanstack state into SQL queries and processes
// the results, including proactive data prefetching for smooth virtual scrolling.
import { type FilterExpr } from '@uwdata/mosaic-core';
import { Query, and, desc, asc } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import type { Table as ArrowTable } from 'apache-arrow';
import type { DataTable } from './DataTable';
import { QueryType } from './types';

/**
 * Part of the MosaicClient interface. Builds the final SQL query to be executed,
 * combining the external filter with the internal TanStack state (sorting, pagination).
 */
export function query<T extends object>(instance: DataTable<T>, externalFilter?: FilterExpr, options?: { type?: string }): Query | null {
    const queryType = options?.type;
    
    const internalFilters = instance._generateFilterPredicates(instance.state);
    const combinedWhere = and(externalFilter, ...internalFilters.where);
    const baseQuery = instance.getBaseQuery({ where: combinedWhere, having: internalFilters.having });

    if (queryType === QueryType.TOTAL_COUNT) {
      return Query.from(baseQuery).select({ total_rows: vg.count() });
    }

    const { sorting } = instance.state;
    const order = sorting.map(s => (s.desc ? desc(s.id) : asc(s.id)));

    const finalQuery = baseQuery
      .orderby(order)
      .limit(instance.chunkSize)
      .offset(instance.offset);
      
    instance.logger.log(`MOSAIC DISPATCH: SQL Built (Offset: ${instance.offset}, Type: ${queryType || 'DATA'})`, finalQuery.toString());
    return finalQuery;
}

/**
 * Part of the MosaicClient lifecycle. Called by the Coordinator with the query result.
 */
export function queryResult<T extends object>(instance: DataTable<T>, data: ArrowTable, query?: any): DataTable<T> {
    const queryOffset = instance.pendingQueryOffset;
    instance.pendingQueryOffset = null;
    
    instance.logger.log(`MOSAIC RECEIVE: queryResult() received ${data.numRows} rows for offset ${queryOffset}.`);
    instance.loadingState = 'idle';
    instance.error = null;
    
    const newRows = data.toArray().map(row => ({ ...row })) as T[];

    if (queryOffset !== instance.offset) {
        instance.logger.warn(`Received data for unexpected offset ${queryOffset} (expected ${instance.offset}). This may be due to a race condition or stale data. Resetting data.`);
        instance.data = newRows;
        instance.offset = (queryOffset ?? 0) + newRows.length;
    } else {
        instance.data = instance.data.concat(newRows);
        instance.offset += newRows.length;
    }
    
    if (newRows.length < instance.chunkSize) {
        instance.logger.log('MOSAIC: End of data detected for current view.');
        instance.isDataLoaded = true;
        instance.isPrefetching = false;
    } else if (!instance.isDataLoaded && !instance.isPrefetching) {
        instance.logger.log(`PROACTIVE: Triggering prefetch for next chunk at offset ${instance.offset}`);
        const prefetchQuery = instance.query(instance.filterBy?.predicate(instance));
        if (prefetchQuery) {
            instance.isPrefetching = true;
            instance.coordinator.prefetch(prefetchQuery.offset(instance.offset))
                .finally(() => { instance.isPrefetching = false; });
        }
    }
    
    instance.table.setOptions(prev => ({ ...prev, data: instance.data }));
    instance.notifyListeners();
    return instance;
}