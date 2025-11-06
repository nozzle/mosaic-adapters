<!-- This is the primary Svelte component that wraps the DataTable logic controller.
It subscribes to the controller's state, creates a reactive Tanstack Table instance,
and renders the full UI including virtualization, headers, and pagination. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { createSvelteTable, flexRender } from '@tanstack/svelte-table';
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  import {
    DataTable,
    type DataTableSnapshot,
    type MosaicColumnDef,
    type DataTableLogicConfig,
    type DataTableUIConfig,
  } from '@nozzleio/mosaic-tanstack-table-core';
  import type { Selection } from '@uwdata/mosaic-core';

  // Component Props
  export let logicConfig: DataTableLogicConfig<any>;
  export let uiConfig: DataTableUIConfig<any>;
  export let filterBy: Selection;
  export let internalFilterAs: Selection | undefined = undefined;
  export let rowSelectionAs: Selection | undefined = undefined;
  export let hoverAs: Selection | undefined = undefined;
  export let clickAs: Selection | undefined = undefined;

  let containerEl: HTMLDivElement;

  const mergedColumns: MosaicColumnDef<any>[] = logicConfig.columns.map(
    (logicCol) => {
      // @ts-expect-error Property 'id' does not exist on type 'LogicColumnDef<any>'
      const uiCol = uiConfig[logicCol.id] || {};
      return {
        ...logicCol,
        ...uiCol,
        meta: {
          ...(logicCol.meta || {}),
          ...(uiCol.meta || {}),
        },
      };
    },
  );

  // --- State Initialization ---
  const logicController = new (class extends DataTable<any> {
    getBaseQuery(filters: { where?: any; having?: any }) {
      return logicConfig.getBaseQuery(filters);
    }
    // @ts-expect-error Expected 0 arguments, but got 1.
  })({
    ...(logicConfig.options || {}),
    columns: mergedColumns,
    filterBy,
    internalFilter: internalFilterAs,
    rowSelectionAs,
    hoverAs,
    clickAs,
    name: logicConfig.name,
    sourceTable: logicConfig.sourceTable,
    groupBy: logicConfig.groupBy,
    primaryKey: logicConfig.primaryKey,
    hoverInteraction: logicConfig.hoverInteraction,
    clickInteraction: logicConfig.clickInteraction,
  });

  const snapshot = writable<DataTableSnapshot<any>>(
    logicController.getSnapshot(),
  );

  // --- Lifecycle Management ---
  onMount(() => {
    const unsubscribe = logicController.subscribe(() => {
      snapshot.set(logicController.getSnapshot());
    });
    const cleanup = logicController.connect();
    return () => {
      unsubscribe();
      cleanup();
    };
  });

  // --- UI State & Helpers ---
  let isResizing = false;
  let resizingColumnId: string | null = null;
  let indicatorOffset = 0;
  let dragInfo = { startClientX: 0, startSize: 0 };

  function getResizeHandler(columnId: string, size: number) {
    return (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragInfo = { startClientX: event.clientX, startSize: size };
      isResizing = true;
      resizingColumnId = columnId;
      indicatorOffset = 0;
    };
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isResizing) return;
    const deltaX = event.clientX - dragInfo.startClientX;
    const newSize = Math.max(80, dragInfo.startSize + deltaX);
    indicatorOffset = newSize - dragInfo.startSize;
  }

  function handlePointerUp(event: PointerEvent) {
    if (!isResizing) return;
    const deltaX = event.clientX - dragInfo.startClientX;
    const finalSize = Math.max(80, dragInfo.startSize + deltaX);

    $snapshot.table.setColumnSizing((prev) => ({
      ...prev,
      [resizingColumnId!]: Math.round(finalSize),
    }));

    isResizing = false;
    resizingColumnId = null;
  }

  // --- ACCESSIBILITY FIX: Keyboard handler for interactive elements ---
  function handleKeyDown(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  }

  // --- Reactive Declarations ---
  $: tanstackTable = createSvelteTable({
    ...$snapshot.table.options,
    state: $snapshot.table.getState(),
  });

  $: rowVirtualizer = createVirtualizer({
    count: $snapshot.table.getRowModel().rows.length,
    getScrollElement: () => containerEl,
    estimateSize: () => 35,
    overscan: 10,
  });

  $: virtualRows = $rowVirtualizer.getVirtualItems();
  $: paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  $: paddingBottom =
    virtualRows.length > 0
      ? $rowVirtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end || 0)
      : 0;
</script>

<!-- Global event listeners for resizing -->
<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
/>
<svelte:body class:isResizing />

{#if $snapshot.error}
  <div style="color: red;">Error: {$snapshot.error.message}</div>
{/if}

{#if $snapshot.isLoading}<div>Loading...</div>{/if}
{#if $snapshot.isLookupPending}<div style="color: blue;">
    Applying advanced filter...
  </div>{/if}

<!-- Column Visibility Toggle -->
<div style="border: 1px solid #ccc; padding: 0.5rem; margin-bottom: 0.5rem;">
  <strong>Toggle Columns:</strong>
  {#each $tanstackTable.getAllLeafColumns() as column}
    <label style="margin-right: 1rem; margin-left: 0.5rem;">
      <input
        type="checkbox"
        checked={column.getIsVisible()}
        on:change={column.getToggleVisibilityHandler()}
        style="margin-right: 0.25rem;"
      />
      {typeof column.columnDef.header === 'string'
        ? column.columnDef.header
        : column.id}
    </label>
  {/each}
</div>

<!-- Main Table UI -->
<div
  bind:this={containerEl}
  on:mouseleave={() => $snapshot.table.options.meta?.onRowHover?.(null)}
  role="region"
  aria-label="Data Table"
  style="height: 250px; overflow: auto; border: 1px solid #ccc;"
>
  <table style="width: 100%; border-spacing: 0; table-layout: fixed;">
    <thead style="position: sticky; top: 0; background: white; z-index: 1;">
      {#each $tanstackTable.getHeaderGroups() as headerGroup}
        <tr>
          {#each headerGroup.headers as header}
            {@const col = header.column}
            <th
              style="width: {header.getSize()}px; text-align: left; padding: 4px; border-bottom: 2px solid black; position: relative;"
            >
              <div
                role="button"
                tabindex="0"
                on:click={col.getToggleSortingHandler()}
                on:keydown={(e) => {
                  // @ts-expect-error Argument of type '((event: unknown) => void) | undefined' is not assignable to parameter of type '() => void'.
                  return handleKeyDown(e, col.getToggleSortingHandler());
                }}
                style="cursor: {col.getCanSort() ? 'pointer' : 'default'};"
              >
                <svelte:component
                  this={flexRender(col.columnDef.header, header.getContext())}
                />
                {col.getIsSorted() === 'asc'
                  ? ' ▲'
                  : col.getIsSorted() === 'desc'
                    ? ' ▼'
                    : ''}
              </div>

              {#if col.getCanFilter() && col.columnDef.meta?.Filter}
                <div>
                  <svelte:component
                    this={col.columnDef.meta.Filter}
                    column={col}
                    table={col.table}
                  />
                </div>
              {/if}

              {#if col.getCanResize()}
                <div
                  on:pointerdown={(e) =>
                    getResizeHandler(col.id, header.getSize())(e)}
                  class="resize-handle"
                />
                {#if isResizing && resizingColumnId === col.id}
                  <div
                    class="resize-indicator-guide"
                    style="transform: translateX({indicatorOffset}px);"
                  />
                {/if}
              {/if}
            </th>
          {/each}
        </tr>
      {/each}
    </thead>
    <tbody>
      {#if paddingTop > 0}
        <tr><td style="height: {paddingTop}px" /></tr>
      {/if}
      {#each virtualRows as virtualRow}
        {@const row = $snapshot.table.getRowModel().rows[virtualRow.index]}
        <tr
          tabindex="0"
          on:mouseenter={() =>
            $snapshot.table.options.meta?.onRowHover?.(row.original)}
          on:click={() =>
            $snapshot.table.options.meta?.onRowClick?.(row.original)}
          on:keydown={(e) =>
            handleKeyDown(e, () =>
              $snapshot.table.options.meta?.onRowClick?.(row.original),
            )}
          style="height: {virtualRow.size}px; cursor: pointer;"
        >
          {#each row.getVisibleCells() as cell}
            <td style="padding: 4px; border-top: 1px solid #eee;">
              <svelte:component
                this={flexRender(cell.column.columnDef.cell, cell.getContext())}
              />
            </td>
          {/each}
        </tr>
      {/each}
      {#if paddingBottom > 0}
        <tr><td style="height: {paddingBottom}px" /></tr>
      {/if}
    </tbody>
  </table>
</div>

<!-- Pagination Controls -->
<div style="display: flex; align-items: center; gap: 8px; padding: 8px 0;">
  <!-- Global Filter -->
  {#if $tanstackTable.options.meta?.hasGlobalFilter}
    <input
      value={$tanstackTable.getState().globalFilter ?? ''}
      on:input={(e) => $tanstackTable.setGlobalFilter(e.currentTarget.value)}
      placeholder="Search all columns..."
      style="margin-right: 1rem;"
    />
  {/if}

  <button
    on:click={() => $tanstackTable.setPageIndex(0)}
    disabled={!$tanstackTable.getCanPreviousPage()}
  >
    &lt;&lt;
  </button>
  <button
    on:click={() => $tanstackTable.previousPage()}
    disabled={!$tanstackTable.getCanPreviousPage()}
  >
    &lt;
  </button>
  <span>
    Page
    <strong>
      {$tanstackTable.getState().pagination.pageIndex + 1} of {$tanstackTable.getPageCount()}
    </strong>
  </span>
  <button
    on:click={() => $tanstackTable.nextPage()}
    disabled={!$tanstackTable.getCanNextPage()}
  >
    &gt;
  </button>
  <button
    on:click={() =>
      $tanstackTable.setPageIndex($tanstackTable.getPageCount() - 1)}
    disabled={!$tanstackTable.getCanNextPage()}
  >
    &gt;&gt;
  </button>
  <select
    value={$tanstackTable.getState().pagination.pageSize}
    on:change={(e) => $tanstackTable.setPageSize(Number(e.currentTarget.value))}
  >
    {#each [10, 100, 1000, 1000000] as pageSize}
      <option value={pageSize}>Show {pageSize}</option>
    {/each}
  </select>
</div>
