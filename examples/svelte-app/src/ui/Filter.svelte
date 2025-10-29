<!-- src/lib/tables/common-ui/Filter.svelte -->
<!-- A generic, debounced text input component used for column-level filtering. -->
<script lang="ts">
	import type { Column } from '@tanstack/svelte-table';

	export let column: Column<any, unknown>;
	
	// --- THE FIX ---
	// Proactively accept the `table` prop, as it's part of the context
	// passed to column filter components, to prevent a future warning.
	export let table: Column<any, unknown>;


	let value = column.getFilterValue() ?? '';
	let timeoutId: number;

	// When the external filter state changes (e.g., cleared), update our local value
	$: if (column.getFilterValue() !== value) {
		value = (column.getFilterValue() as string) ?? '';
	}

	function onInput(e: Event) {
		const targetValue = (e.target as HTMLInputElement).value;
		value = targetValue;
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			column.setFilterValue(targetValue);
		}, 300);
	}
</script>

<input
	type="text"
	{value}
	on:input={onInput}
	on:click={(e) => e.stopPropagation()}
	placeholder="Search..."
	style="width: 100%; border: 1px solid #ccc; border-radius: 4px;"
/>