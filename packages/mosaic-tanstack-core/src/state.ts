// packages/mosaic-tanstack-core/src/state.ts
// This file encapsulates all the logic for managing and responding to state
// changes from the TanStack Table instance. It acts as the bridge between
// UI-driven state and the actions (queries, selections) of the DataTable.
import { type Updater, type TableState } from '@tanstack/table-core';
import { literal, and, sql, or, not, eq, type SQLAst } from '@uwdata/mosaic-sql';
import { createPredicateFromRowId } from './util';
import type { DataTable } from './DataTable';
import { QueryType } from './types';

/**
 * Generates SQL predicates from the current TanStack filter state (`columnFilters`
 * and `globalFilter`), correctly separating them into `WHERE` and `HAVING` clauses
 * if the query is grouped.
 */
function generateFilterPredicates<T extends object>(instance: DataTable<T>): { where: SQLAst[], having: SQLAst[] } {
    const state = instance.state;
    const createPredicate = (id: string, value: any) => sql`CAST(${id} AS VARCHAR) ILIKE ${literal(`%${value}%`)}`;
    
    if (instance.groupByKeys.length === 0) {
        const where: SQLAst[] = [];
        for (const f of state.columnFilters) {
            if (f.value != null && f.value !== '') where.push(createPredicate(f.id, f.value));
        }
        if (state.globalFilter) {
            const searchableColumns = instance.columns.filter(c => c.meta?.enableGlobalFilter);
            const globalPredicates = searchableColumns.map(c => createPredicate(c.id!, state.globalFilter));
            if (globalPredicates.length > 0) where.push(or(...globalPredicates));
        }
        return { where, having: [] };
    }

    const where: SQLAst[] = [];
    const having: SQLAst[] = [];
    for (const f of state.columnFilters) {
        if (f.value != null && f.value !== '') {
            const predicate = createPredicate(f.id, f.value);
            if (instance.groupByKeys.includes(f.id)) where.push(predicate);
            else having.push(predicate);
        }
    }

    if (state.globalFilter) {
        const searchableColumns = instance.columns.filter(c => c.meta?.enableGlobalFilter);
        const globalWherePredicates: SQLAst[] = [], globalHavingPredicates: SQLAst[] = [];
        searchableColumns.forEach(c => {
            const predicate = createPredicate(c.id!, state.globalFilter);
            if (instance.groupByKeys.includes(c.id!)) globalWherePredicates.push(predicate);
            else globalHavingPredicates.push(predicate);
        });
        if (globalWherePredicates.length > 0) where.push(or(...globalWherePredicates));
        if (globalHavingPredicates.length > 0) having.push(or(...globalHavingPredicates));
    }
    return { where, having };
}

/**
 * Translates changes in TanStack's row selection state into an `OR`'d SQL
 * predicate and updates the `rowSelectionAs` Mosaic Selection.
 */
function handleRowSelectionChange<T extends object>(instance: DataTable<T>) {
    if (!instance.rowSelectionSelection) return;
    instance.logger.log('MOSAIC: Handling row selection change. `isSelectAll` is', instance.state.isSelectAll);

    if (instance.state.isSelectAll) {
        const deselectedKeys = Object.keys(instance.state.rowSelection).filter(key => !instance.state.rowSelection[key]);
        if (deselectedKeys.length > 0) {
            const deselectedPredicates = deselectedKeys.map(id => createPredicateFromRowId(id, instance.primaryKey, instance.logger)).filter((p): p is SQLAst => p !== null);
            const finalPredicate = not(or(...deselectedPredicates));
            instance.logger.log('MOSAIC: Broadcasting "Select All" with exceptions predicate.');
            instance.rowSelectionSelection.update({ source: `${instance.sourceName}_row_selection`, predicate: finalPredicate });
        } else {
            instance.logger.log('MOSAIC: Broadcasting "Select All" (WHERE TRUE) predicate.');
            instance.rowSelectionSelection.update({ source: `${instance.sourceName}_row_selection`, predicate: null }); // WHERE TRUE
        }
        return;
    }

    const selectedKeys = Object.keys(instance.state.rowSelection).filter(key => instance.state.rowSelection[key]);
    
    const newPredicateCache = new Map<string, SQLAst | null>();
    for (const id of selectedKeys) {
        let predicate = instance.rowSelectionPredicates.get(id);
        if (!predicate) {
            predicate = createPredicateFromRowId(id, instance.primaryKey, instance.logger);
        }
        newPredicateCache.set(id, predicate);
    }
    instance.rowSelectionPredicates = newPredicateCache;

    const activePredicates = Array.from(instance.rowSelectionPredicates.values()).filter((p): p is SQLAst => p !== null);
    const finalPredicate = activePredicates.length > 0 ? or(...activePredicates) : null;
    instance.logger.log('MOSAIC: Broadcasting individual row selection predicate. Total selected:', activePredicates.length);
    instance.rowSelectionSelection.update({ source: `${instance.sourceName}_row_selection`, predicate: finalPredicate });
}

/**
 * Handles changes to the internal filter state, potentially performing a "reverse lookup"
 * query if filtering is needed on an aggregated column. Updates the `internalFilterAs` selection.
 */
async function handleInternalFilterChange<T extends object>(instance: DataTable<T>) {
    if (!instance.internalFilterSelection) return;
    instance.logger.log('MOSAIC: Handling internal filter change.');

    const { where, having } = generateFilterPredicates(instance);
    let finalPredicate: SQLAst | null = null;
    if (having.length > 0) {
        instance.logger.log('MOSAIC: Detected HAVING clause filter. Performing reverse lookup query.');
        instance.loadingState = 'lookup';
        instance.notifyListeners();
        try {
            const externalPredicate = instance.filterBy?.predicate(instance);
            const lookupQuery = instance.getBaseQuery({ where: externalPredicate, having: having }).select(instance.groupByKeys);
            const result = await instance.coordinator.query(lookupQuery);
            const validKeys = result.toArray().map((row: any) => ({...row}));
            if (validKeys.length > 0) {
                const keyPredicates = validKeys.map(keyRow => {
                    const keyParts = instance.groupByKeys.map(key => eq(key, literal(keyRow[key])));
                    return and(...keyParts);
                });
                const reverseLookupPredicate = or(...keyPredicates);
                finalPredicate = and(...where, reverseLookupPredicate);
            } else {
                finalPredicate = sql`FALSE`;
            }
        } catch (err) {
            instance.queryError(err as Error);
            return;
        } finally {
            if (instance.loadingState === 'lookup') instance.loadingState = 'idle';
        }
    } else {
        finalPredicate = and(...where);
    }
    instance.logger.log('MOSAIC: Broadcasting internal filter predicate.');
    instance.internalFilterSelection.update({ source: `${instance.sourceName}_internal_filters`, predicate: finalPredicate });
}

/**
 * The core state update handler. Called by TanStack Table whenever an action occurs.
 * It determines what changed and triggers the appropriate Mosaic-side effect.
 */
export function handleStateUpdate<T extends object>(instance: DataTable<T>, updater: Updater<TableState>) {
    if (!instance.isInitialized) {
        instance.logger.warn('STATE: `_updateState` called before client is fully initialized. Ignoring.');
        return;
    }
    const prevState = instance.state;
    const newState = typeof updater === 'function' ? updater(prevState) : updater;
    
    if (JSON.stringify(prevState) === JSON.stringify(newState)) return;

    instance.logger.log('STATE: `_updateState` called. Analyzing changes.');

    const filterChanged = JSON.stringify(newState.columnFilters) !== JSON.stringify(prevState.columnFilters) || newState.globalFilter !== prevState.globalFilter;
    const sortChanged = JSON.stringify(newState.sorting) !== JSON.stringify(prevState.sorting);
    const pageChanged = newState.pagination.pageIndex !== prevState.pagination.pageIndex;
    const rowSelectionChanged = JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection) || newState.isSelectAll !== prevState.isSelectAll;

    if (filterChanged) instance.logger.log('STATE: Column/global filters changed.');
    if (sortChanged) instance.logger.log('STATE: Sorting changed.');
    if (pageChanged) instance.logger.log('STATE: Page index changed.');
    if (rowSelectionChanged) instance.logger.log('STATE: Row selection changed.');

    if (prevState.isSelectAll && JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection)) {
        instance.logger.log('STATE: Individual row toggled while "Select All" was active. Deactivating "Select All".');
        newState.isSelectAll = false;
    }

    instance.state = newState;
    instance.table.setOptions(prev => ({ ...prev, state: instance.state, data: instance.data }));
    instance.notifyListeners(); 

    if (filterChanged || sortChanged || pageChanged) {
        instance.logger.log('STATE: Resetting data due to filter, sort, or page change.');
        instance.data = [];
        instance.offset = newState.pagination.pageIndex * newState.pagination.pageSize;
        instance.isDataLoaded = false;
        
        if (!instance.initialFetchDispatched || filterChanged || sortChanged || pageChanged) {
          instance.initialFetchDispatched = true;
          const externalFilter = instance.filterBy?.predicate(instance);

          const dataQuery = instance.query(externalFilter, { type: QueryType.DATA });
          if (dataQuery) {
            instance.pendingQueryOffset = instance.offset;
            instance.requestQuery(dataQuery);
          }

          if (filterChanged || sortChanged) {
              instance.totalRows = -1;
              const countQuery = instance.query(externalFilter, { type: QueryType.TOTAL_COUNT });
              if (countQuery) instance.requestQuery(countQuery);
          }
        }
    }
    
    if (filterChanged) {
        handleInternalFilterChange(instance);
    }

    if (rowSelectionChanged) {
        handleRowSelectionChange(instance);
    }
}

// Export generateFilterPredicates for use in the mosaic module
export { generateFilterPredicates };