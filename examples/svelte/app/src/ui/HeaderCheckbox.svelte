<!-- src/lib/tables/common-ui/HeaderCheckbox.svelte -->
<!-- This is a new, SPECIALIZED component for rendering the 'select all' checkbox in a table header.
It ONLY requires the `table` prop from the Tanstack context. -->
<script lang="ts">
  import type { Table, Header, Column } from '@tanstack/svelte-table';

  export let table: Table<any>;

  // --- THE FIX: Silence unused export warnings ---
  // These props are passed by Tanstack's flexRender in a header context.
  // We declare them to prevent "unknown prop" errors and ignore the "unused" warning.
  // svelte-ignore unused-export-let
  export let header: Header<any, unknown>;
  // svelte-ignore unused-export-let
  export let column: Column<any, unknown>;

  let ref: HTMLInputElement;

  // This reactive statement is the core logic for the indeterminate state.
  $: if (ref) {
    ref.indeterminate = table.getIsSomeRowsSelected();
  }
</script>

<input
  type="checkbox"
  bind:this={ref}
  checked={table.getIsAllRowsSelected()}
  on:change={table.getToggleAllRowsSelectedHandler()}
  style="width: 20px; height: 20px;"
/>
