// src/lib/tables/flights/ui.ts
// This file provides the Svelte-specific UI layer configuration for the Flights table.
import type {
  DataTableUIConfig,
  Flight,
} from '../../../../../packages/mosaic-tanstack-table-core/src';
import HeaderCheckbox from '../../ui/HeaderCheckbox.svelte';
import RowCheckbox from '../../ui/RowCheckbox.svelte';
import Filter from '../../ui/Filter.svelte';

export const flightsUIConfig: DataTableUIConfig<Flight> = {
  select: {
    header: HeaderCheckbox,
    cell: RowCheckbox,
  },
  id: { header: () => 'ID', meta: { Filter } },
  delay: {
    header: () => 'Arrival Delay (min)',
    cell: (info: any) => (info.getValue() as number).toFixed(0),
    meta: { Filter },
  },
  distance: {
    header: () => 'Distance (miles)',
    cell: (info: any) => (info.getValue() as number).toLocaleString(),
    meta: { Filter },
  },
  time: {
    header: () => 'Departure Time (hour)',
    cell: (info: any) => (info.getValue() as number).toFixed(2),
    meta: { Filter },
  },
};
