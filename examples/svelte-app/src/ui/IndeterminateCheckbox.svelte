<!-- src/lib/tables/common-ui/IndeterminateCheckbox.svelte -->
<!-- A reusable checkbox component that correctly handles Tanstack Table's three states:
checked, unchecked, and indeterminate (for the 'select all' header). -->
<script lang="ts">
  import type {
    Table,
    Row,
    Header,
    Column,
    Cell,
  } from '@tanstack/svelte-table';

  export let table: Table<any>;
  export let row: Row<any> | undefined = undefined;

  // --- THE FIX: Silence unused export warnings ---
  // These props are part of the public API contract for a Tanstack cell/header renderer.
  // We accept them to prevent "unknown prop" errors, but we don't use them all.
  // This directive tells the Svelte compiler to ignore the "unused" warning for them.
  // svelte-ignore unused-export-let
  export let header: Header<any, unknown> | undefined = undefined;
  // svelte-ignore unused-export-let
  export let column: Column<any, unknown> | undefined = undefined;
  // svelte-ignore unused-export-let
  export let cell: Cell<any, unknown> | undefined = undefined;
  // svelte-ignore unused-export-let
  export let getValue: (() => any) | undefined = undefined;
  // svelte-ignore unused-export-let
  export let renderValue: (() => any) | undefined = undefined;

  let ref: HTMLInputElement;

  const isCell = !!row;

  $: if (!isCell && ref) {
    ref.indeterminate = table.getIsSomeRowsSelected();
  }

  $: props = isCell
    ? {
        // Row Checkbox Logic
        checked: row!.getIsSelected(),
        disabled: !row!.getCanSelect(),
        onchange: row!.getToggleSelectedHandler(),
      }
    : {
        // Header Checkbox Logic
        checked: table.getIsAllRowsSelected(),
        onchange: table.getToggleAllRowsSelectedHandler(),
        disabled: false,
      };
</script>

<input
  type="checkbox"
  bind:this={ref}
  checked={props.checked}
  disabled={props.disabled}
  on:change={props.onchange}
  style="width: 20px; height: 20px;"
/>
