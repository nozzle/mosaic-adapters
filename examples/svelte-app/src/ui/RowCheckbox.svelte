<!-- src/lib/tables/common-ui/RowCheckbox.svelte -->
<!-- This is a new, SPECIALIZED component for rendering the checkbox in a table data cell.
It ONLY requires the `row` prop from the Tanstack context. -->
<script lang="ts">
  import type { Row, Cell, Column, Table } from '@tanstack/svelte-table';

  export let row: Row<any>;

  // --- THE FIX: Accept and ignore all other context props ---
  // These props are passed by Tanstack's flexRender but are not used by this specific component.
  // We declare them to prevent "unknown prop" warnings from the Svelte compiler.
  // svelte-ignore unused-export-let
  export let table: Table<any>;
  // svelte-ignore unused-export-let
  export let column: Column<any, unknown>;
  // svelte-ignore unused-export-let
  export let cell: Cell<any, unknown>;
  // svelte-ignore unused-export-let
  export let getValue: (() => any) | undefined = undefined;
  // svelte-ignore unused-export-let
  export let renderValue: (() => any) | undefined = undefined;
</script>

<input
  type="checkbox"
  checked={row.getIsSelected()}
  disabled={!row.getCanSelect()}
  on:change={row.getToggleSelectedHandler()}
  style="width: 20px; height: 20px;"
/>
