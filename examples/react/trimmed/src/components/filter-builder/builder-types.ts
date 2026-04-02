import type { FilterDefinition } from '@nozzleio/mosaic-tanstack-react-table';

export type ActiveFilterIds = Array<string>;

export interface ActiveFilterListState {
  activeFilterIds: ActiveFilterIds;
  searchTerm: string;
}

export interface FilterCatalogSection {
  id: string;
  label: string;
  filters: Array<FilterDefinition>;
}
