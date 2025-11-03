// packages/mosaic-tanstack-core/src/mosaic.ts
// This file has been updated to fix a critical bug in the COUNT query generation.
// The logic now robustly wraps the base query as a subquery to get the total row count,
// ensuring it works correctly with complex queries involving window functions, aggregations,
// or subqueries, thus fixing the "Last Page" button functionality.
import { type FilterExpr } from '@uwdata/mosaic-core';
import { Query, and, desc, asc } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import type { Table as ArrowTable } from 'apache-arrow';
import type { DataTable } from './DataTable';
import { QueryType } from './types';

/**
 * Part of the MosaicClient lifecycle. Generates a query to fetch schema metadata.
 */
export function fields<T extends object>(instance: DataTable<T>) {
    instance.logger.log('MOSAIC: `fields()` called. Generating metadata query.');
    let fromTable: string | undefined = instance.sourceTable;

    if (!fromTable) {
        const baseQuery = instance.getBaseQuery({});
        // @ts-ignore
        const fromClause = baseQuery.clauses.from[0];
        fromTable = fromClause?.from;
    }

    if (!fromTable || typeof fromTable !== 'string') {
        const errorMsg = `Could not determine a source table for metadata query. Please add a 'sourceTable' property to your logic config.`;
        instance.logger.error(errorMsg);
        throw new Error(`[${instance.sourceName}] ${errorMsg}`);
    }
    
    const baseColumns = instance.columns.map(c => c.id).filter(id => id && !['select', 'rank'].includes(id));
    const query = Query.from(fromTable).select(...baseColumns);
    instance.logger.log('MOSAIC: `fields()` returning query:', query.toString());
    return query;
}

/**
 * Part of the MosaicClient lifecycle. Receives schema info and caches it.
 */
export function fieldInfo<T extends object>(instance: DataTable<T>, info: { column: string, type: any }[]) {
    instance.logger.log('MOSAIC: `fieldInfo()` called with schema:', info);
    instance.schema.clear();
    for (const { column, type } of info) {
        instance.schema.set(column, type);
    }
    instance.logger.log('MOSAIC: Schema cached. Now waiting for state update to trigger query.');
}

/**
 * Part of the MosaicClient interface. Builds the final SQL query to be executed,
 * combining the external filter with the internal TanStack state (sorting, pagination).
 */
export function query<T extends object>(instance: DataTable<T>, externalFilter?: FilterExpr, options?: { type?: string }): Query | null {
    const queryType = options?.type;
    instance.logger.log(`MOSAIC: \`query()\` called. Type: ${queryType || 'DATA'}, External Filter:`, externalFilter);
    
    // @ts-ignore
    const internalFilters = instance._generateFilterPredicates(instance.state);
    const combinedWhere = and(externalFilter, ...internalFilters.where);
    const baseQuery = instance.getBaseQuery({ where: combinedWhere, having: internalFilters.having });

    if (queryType === QueryType.TOTAL_COUNT) {
        // This is the robust way to count the results of any base query.
        // It wraps the entire base query as a subquery and counts its resulting rows.
        // This correctly handles complex queries with window functions, aggregations, etc.
        return Query.from(baseQuery).select({ total_rows: vg.count() });
    }

    const { sorting } = instance.state;
    const order = sorting.map(s => (s.desc ? desc(s.id) : asc(s.id)));

    const finalQuery = baseQuery
      .orderby(order)
      .limit(instance.chunkSize)
      .offset(instance.offset);
      
    instance.logger.log('MOSAIC: `query()` returning SQL:', finalQuery.toString());
    return finalQuery;
}

/**
 * Part of the MosaicClient lifecycle. Called by the Coordinator with the query result.
 */
export function queryResult<T extends object>(instance: DataTable<T>, data: ArrowTable, query?: any): DataTable<T> {
    const queryType = instance.pendingQueryOffset !== null ? QueryType.DATA : QueryType.TOTAL_COUNT;
    const queryOffset = instance.pendingQueryOffset;
    instance.pendingQueryOffset = null;
    
    instance.logger.log(`MOSAIC: \`queryResult()\` received ${data.numRows} rows for a ${queryType} query.`);
    instance.loadingState = 'idle';
    instance.error = null;

    if (queryType === QueryType.TOTAL_COUNT) {
        const total = data.get(0)?.total_rows;
        if (typeof total === 'number' && instance.totalRows !== total) {
            instance.logger.log(`MOSAIC: Total row count updated from ${instance.totalRows} to ${total}.`);
            instance.totalRows = total;
            instance.table.setOptions(prev => ({
                ...prev,
                pageCount: Math.ceil(instance.totalRows / instance.state.pagination.pageSize),
            }));
            instance.notifyListeners();
        }
        return instance;
    }
    
    const newRows = data.toArray().map(row => ({ ...row })) as T[];
    
    const pageBaseOffset = instance.state.pagination.pageIndex * instance.state.pagination.pageSize;
    const expectedOffsetForAppend = pageBaseOffset + instance.data.length;

    if (queryOffset === expectedOffsetForAppend) {
        instance.logger.log(`Received data for offset ${queryOffset}. Performing an APPEND.`);
        instance.data = instance.data.concat(newRows);
    } else {
        instance.logger.log(`Received data for offset ${queryOffset}, which does not match expected append offset ${expectedOffsetForAppend}. Performing a RESET.`);
        instance.data = newRows;
    }
    
    instance.offset = pageBaseOffset + instance.data.length;

    if (newRows.length < instance.chunkSize) {
        instance.logger.log('MOSAIC: End of data detected for current view.');
        instance.isDataLoaded = true;
    }
    
    instance.table.setOptions(prev => ({ ...prev, data: instance.data }));
    instance.notifyListeners();
    return instance;
}