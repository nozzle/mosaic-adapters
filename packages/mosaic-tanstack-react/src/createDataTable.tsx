// This file contains the factory function `createDataTable`. It is a React-specific
// layer that wraps the UI-agnostic DataTable class. It is responsible for rendering the UI,
// managing UI-specific side effects (like column resizing), and wiring the DataTable's
// callbacks to the Mosaic Provider's selections.
import React, { Fragment, useState, useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Selection, Query } from '@uwdata/mosaic-core';
import {
    DataTable,
    type DataTableOptions,
    type MosaicColumnDef,
    type DataTableLogicConfig,
    type DataTableUIConfig
} from '@mosaic-tanstack/core';
import { flexRender } from '@tanstack/react-table';
import {
    Table as TanstackTable,
    TableState,
} from '@tanstack/table-core';

interface ResizeState {
    isResizing: boolean;
    resizingColumnId: string | null;
    indicatorOffset: number;
}

function useColumnResizing(table: TanstackTable<any>) {
    const [resizeState, setResizeState] = useState<ResizeState>({
        isResizing: false,
        resizingColumnId: null,
        indicatorOffset: 0,
    });

    const dragInfo = useRef({ startClientX: 0, startSize: 0 });

    useEffect(() => {
        const handleMove = (event: PointerEvent) => {
            const deltaX = event.clientX - dragInfo.current.startClientX;
            const newSize = Math.max(80, dragInfo.current.startSize + deltaX);
            setResizeState(prev => ({ ...prev, indicatorOffset: newSize - dragInfo.current.startSize }));
        };

        const handleUp = (event: PointerEvent) => {
            const deltaX = event.clientX - dragInfo.current.startClientX;
            const finalSize = Math.max(80, dragInfo.current.startSize + deltaX);
            
            table.setColumnSizing(prev => ({
                ...prev,
                [resizeState.resizingColumnId!]: Math.round(finalSize),
            }));

            setResizeState({ isResizing: false, resizingColumnId: null, indicatorOffset: 0 });
        };

        if (resizeState.isResizing) {
            document.body.classList.add('is-resizing');
            document.addEventListener('pointermove', handleMove);
            document.addEventListener('pointerup', handleUp, { once: true });
        }

        return () => {
            document.body.classList.remove('is-resizing');
            document.removeEventListener('pointermove', handleMove);
            document.removeEventListener('pointerup', handleUp);
        };
    }, [resizeState.isResizing, resizeState.resizingColumnId, table]);

    const getResizeHandler = (columnId: string, size: number) => {
        return (event: React.PointerEvent) => {
            if (event.button !== 0) return;
            dragInfo.current = { startClientX: event.clientX, startSize: size };
            setResizeState({ isResizing: true, resizingColumnId: columnId, indicatorOffset: 0 });
        };
    };
    
    return { getResizeHandler, resizeState };
}

const GlobalFilter = ({ table }: { table: TanstackTable<any> }) => {
    const [value, setValue] = useState(table.getState().globalFilter || '');
    useEffect(() => {
        const timeout = setTimeout(() => {
            table.setGlobalFilter(value);
        }, 300);
        return () => clearTimeout(timeout);
    }, [value, table]);
    
    return (
        <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Search all columns..."
            style={{ marginRight: '1rem' }}
        />
    );
};

const ColumnVisibilityToggle = ({ table }: { table: TanstackTable<any> }) => (
    <div style={{ border: '1px solid #ccc', padding: '0.5rem', marginBottom: '0.5rem' }}>
        <strong>Toggle Columns:</strong>
        {table.getAllLeafColumns().map(column => (
            <label key={column.id} style={{ marginRight: '1rem', marginLeft: '0.5rem' }}>
                <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                    style={{ marginRight: '0.25rem' }}
                />
                {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
            </label>
        ))}
    </div>
);

const PaginationControls = ({ table }: { table: TanstackTable<any> }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
        {table.options.meta?.hasGlobalFilter && <GlobalFilter table={table} />}
        <button onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
            {'<<'}
        </button>
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            {'<'}
        </button>
        <span>
            Page{' '}
            <strong>
                {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </strong>
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            {'>'}
        </button>
        <button onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
            {'>>'}
        </button>
        <select
            value={table.getState().pagination.pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
        >
            {[10, 100, 1000, 1000000].map(pageSize => (
                <option key={pageSize} value={pageSize}>
                    Show {pageSize}
                </option>
            ))}
        </select>
    </div>
);

interface TableUIProps<TData extends object> {
    table: TanstackTable<TData>;
    containerRef: React.RefObject<HTMLDivElement>;
    getResizeHandler: (columnId: string, size: number) => (event: React.PointerEvent) => void;
    resizeState: ResizeState;
}

function TableUI<TData extends object>({ table, containerRef, getResizeHandler, resizeState }: TableUIProps<TData>) {
    const { rows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
        count: table.getRowModel().rows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => 35,
        overscan: 10,
    });
    
    const virtualRows = rowVirtualizer.getVirtualItems();
    const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
    const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end || 0) : 0;

    return (
        <div
            ref={containerRef}
            onMouseLeave={() => table.options.meta?.onRowHover?.(null)}
            style={{ height: '250px', overflow: 'auto', border: '1px solid #ccc' }}
        >
            <table style={{ width: '100%', borderSpacing: 0, tableLayout: 'fixed' }}>
                <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
                            {headerGroup.headers.map(header => {
                                return (
                                    <th key={header.id} style={{ width: header.getSize(), textAlign: 'left', padding: '4px', borderBottom: '2px solid black', position: 'relative' }}>
                                        <div onClick={header.column.getToggleSortingHandler()} style={{ cursor: header.column.getCanSort() ? 'pointer' : 'default' }}>
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? null}
                                        </div>
                                        {header.column.getCanFilter() ? (
                                            <div>{header.column.columnDef.meta?.Filter && flexRender(header.column.columnDef.meta.Filter, { column: header.column })}</div>
                                        ) : null}

                                        {header.column.getCanResize() && (
                                            <>
                                                <div
                                                    onPointerDown={getResizeHandler(header.column.id, header.getSize())}
                                                    className="resize-handle"
                                                />
                                                {resizeState.isResizing && resizeState.resizingColumnId === header.column.id && (
                                                    <div
                                                        className="resize-indicator-guide"
                                                        style={{ transform: `translateX(${resizeState.indicatorOffset}px)` }}
                                                    />
                                                )}
                                            </>
                                        )}
                                    </th>
                                )
                            })}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {paddingTop > 0 && <tr><td style={{ height: `${paddingTop}px` }} /></tr>}
                    {virtualRows.map(virtualRow => {
                        const row = rows[virtualRow.index];
                        return (
                            <tr
                                key={row.id} 
                                onMouseEnter={() => table.options.meta?.onRowHover?.(row.original)}
                                onClick={() => table.options.meta?.onRowClick?.(row.original)}
                                style={{
                                    height: `${virtualRow.size}px`,
                                    cursor: table.options.meta?.onRowHover || table.options.meta?.onRowClick ? 'pointer' : 'default'
                                }}
                            >
                                {row.getVisibleCells().map(cell => (
                                    <td key={cell.id} style={{ padding: '4px', borderTop: '1px solid #eee' }}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                    {paddingBottom > 0 && <tr><td style={{ height: `${paddingBottom}px` }} /></tr>}
                </tbody>
            </table>
        </div>
    );
}

export interface CreatedTableProps {
    /** The primary Mosaic Selection used to filter the data displayed in this table. */
    filterBy: Selection;
    /** 
     * An output selection that is updated with a predicate representing this
     * table's own internal filters (column search, global search). This allows
     * the table's internal state to participate in the global Mosaic filter graph.
     */
    internalFilterAs?: Selection;
    /** 
     * An output selection that is updated with a predicate representing the
     * set of currently selected rows (via checkboxes).
     */
    rowSelectionAs?: Selection;
    /**
     * An output selection updated with the "raw" predicate of the hovered row.
     * See the design pattern documentation in `DataTableOptions` for detailed
     * guidance on using this in combination with a composite selection for highlighting.
     */
    hoverAs?: Selection;
    /**
     * An output selection updated with the "raw" predicate of the clicked row.
     * Follows the same design pattern as `hoverAs`.
     */
    clickAs?: Selection;
}

export function createDataTable<TData extends object>(
    logicConfig: DataTableLogicConfig<TData>,
    uiConfig: DataTableUIConfig<TData>
) {
  
  return function CreatedTableComponent(props: CreatedTableProps) {
    const { filterBy, internalFilterAs, rowSelectionAs, hoverAs, clickAs } = props;

    const [logicController] = useState(() => {
        const mergedColumns: MosaicColumnDef<TData>[] = logicConfig.columns.map(logicCol => {
            const uiCol = uiConfig[logicCol.id] || {};
            return {
              ...logicCol,
              ...uiCol,
              meta: {
                ...(logicCol.meta || {}),
                ...(uiCol.meta || {}),
              }
            };
          });

      class SpecificDataTable extends DataTable<TData> {
        getBaseQuery(filters: { where?: any, having?: any }): Query {
          return logicConfig.getBaseQuery(filters);
        }
      }

      const dtOptions: DataTableOptions<TData> = {
        ...(logicConfig.options || {}),
        columns: mergedColumns,
        groupBy: logicConfig.groupBy,
        primaryKey: logicConfig.primaryKey,
        filterBy: filterBy,
        internalFilter: internalFilterAs,
        rowSelectionAs: rowSelectionAs,
        hoverAs: hoverAs,
        clickAs: clickAs,
        name: logicConfig.name,
        hoverInteraction: logicConfig.hoverInteraction,
        clickInteraction: logicConfig.clickInteraction,
        meta: {
            // These handlers are now defined inside the engine, but we pass them
            // through the Tanstack `meta` object so our React UI can access them
            // via table.options.meta.onRowHover, etc.
          }
      };
      
      const controller = new SpecificDataTable(dtOptions);
      return controller;
    });
    
    const { table, isLoading, error, isLookupPending } = useSyncExternalStore(
      logicController.subscribe,
      logicController.getSnapshot
    );

    useEffect(() => {
        const cleanup = logicController.connect();
        return cleanup;
    }, [logicController]);
    
    const { getResizeHandler, resizeState } = useColumnResizing(table);
    const tableContainerRef = useRef<HTMLDivElement>(null);

    if (error) { return <div style={{color: 'red'}}>Error: {error.message}</div>; }
  
    return (
      <Fragment>
          {isLoading && <div>Loading...</div>}
          {isLookupPending && <div style={{ color: 'blue' }}>Applying advanced filter...</div>}
          <ColumnVisibilityToggle table={table} />
          <TableUI 
            table={table} 
            containerRef={tableContainerRef}
            getResizeHandler={getResizeHandler}
            resizeState={resizeState}
          />
          <PaginationControls table={table} />
      </Fragment>
    );
  };
}