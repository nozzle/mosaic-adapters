import type { FilterDefinition } from '@nozzleio/mosaic-tanstack-react-table';
import type {
  ActiveFilterIds,
  FilterCatalogSection,
} from '@/components/filter-builder/builder-types';

function normalizeSearchTerm(searchTerm: string) {
  return searchTerm.trim().toLowerCase();
}

function getCatalogGroupLabel(definition: FilterDefinition) {
  switch (definition.valueKind) {
    case 'text':
      return 'Text';
    case 'facet-single':
    case 'facet-multi':
      return 'Facet';
    default:
      return 'Range';
  }
}

export function isFilterActive(
  activeFilterIds: ActiveFilterIds,
  filterId: string,
) {
  return activeFilterIds.includes(filterId);
}

export function getAvailableFiltersForScope(
  definitions: Array<FilterDefinition>,
  activeFilterIds: ActiveFilterIds,
  searchTerm: string,
) {
  const normalizedSearchTerm = normalizeSearchTerm(searchTerm);

  return definitions.filter((definition) => {
    if (isFilterActive(activeFilterIds, definition.id)) {
      return false;
    }

    if (!normalizedSearchTerm) {
      return true;
    }

    return definition.label.toLowerCase().includes(normalizedSearchTerm);
  });
}

export function getFilterCatalogSections(
  definitions: Array<FilterDefinition>,
): Array<FilterCatalogSection> {
  const sections = new Map<string, FilterCatalogSection>();

  definitions.forEach((definition) => {
    const label = getCatalogGroupLabel(definition);
    const existingSection = sections.get(label);
    if (existingSection) {
      existingSection.filters.push(definition);
      return;
    }

    sections.set(label, {
      id: label.toLowerCase(),
      label,
      filters: [definition],
    });
  });

  return Array.from(sections.values());
}

export function addFilter(
  activeFilterIds: ActiveFilterIds,
  filterId: string,
): ActiveFilterIds {
  if (isFilterActive(activeFilterIds, filterId)) {
    return activeFilterIds;
  }

  return [...activeFilterIds, filterId];
}

export function removeFilter(
  activeFilterIds: ActiveFilterIds,
  filterId: string,
): ActiveFilterIds {
  if (!isFilterActive(activeFilterIds, filterId)) {
    return activeFilterIds;
  }

  return activeFilterIds.filter(
    (activeFilterId) => activeFilterId !== filterId,
  );
}
