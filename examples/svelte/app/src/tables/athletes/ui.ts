// src/lib/tables/athletes/ui.ts
// This file provides the Svelte-specific UI layer configuration for the Athletes table.
// It imports Svelte components and maps them to the table's header and cell renderers.
import HeaderCheckbox from '../../ui/HeaderCheckbox.svelte';
import RowCheckbox from '../../ui/RowCheckbox.svelte';
import Filter from '../../ui/Filter.svelte';
import type {
  Athlete,
  DataTableUIConfig,
} from '@nozzleio/mosaic-tanstack-table-core';

export const athletesUIConfig: DataTableUIConfig<Athlete> = {
  select: {
    header: HeaderCheckbox,
    cell: RowCheckbox,
  },
  rank: { header: () => 'Rank' },
  name: { header: () => 'Name', meta: { Filter } },
  nationality: { header: () => 'Nationality', meta: { Filter } },
  sex: { header: () => 'Sex', meta: { Filter } },
  height: { header: () => 'Height', meta: { Filter } },
  weight: { header: () => 'Weight', meta: { Filter } },
  sport: { header: () => 'Sport', meta: { Filter } },
};
