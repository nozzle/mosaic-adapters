import type {
  FilterBindingPersister,
  FilterBindingState,
  FilterDefinition,
  FilterScopePersister,
} from '@nozzleio/mosaic-tanstack-react-table';

const PAGE_SCOPE_ROWS_PARAM = 'fb_page_rows';
const PAGE_SCOPE_FILTERS_PARAM = 'fb_page_filters';
const WIDGET_SCOPE_ROWS_PARAM = 'fb_widget_rows';
const WIDGET_SCOPE_FILTERS_PARAM = 'fb_widget_filters';

type UrlPersistenceConfig = {
  filtersParam: string;
  rowsParam: string;
};

function readJsonSearchParam<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = new URLSearchParams(window.location.search).get(key);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function writeJsonSearchParam(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams(window.location.search);

  if (value === null || value === undefined) {
    params.delete(key);
  } else {
    params.set(key, JSON.stringify(value));
  }

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
  window.history.replaceState({}, '', nextUrl);
}

function isKnownFilterId(
  definitions: Array<FilterDefinition>,
  filterId: string,
): boolean {
  return definitions.some((definition) => definition.id === filterId);
}

function readScopeUrlFilterIds(
  config: UrlPersistenceConfig,
  definitions: Array<FilterDefinition>,
  fallbackFilterIds: Array<string>,
): Array<string> {
  const persistedFilterIds =
    readJsonSearchParam<Array<string>>(config.rowsParam) ?? [];
  const persistedSnapshot =
    readJsonSearchParam<Partial<Record<string, FilterBindingState>>>(
      config.filtersParam,
    ) ?? {};

  const normalizedFilterIds = persistedFilterIds.filter((filterId) =>
    isKnownFilterId(definitions, filterId),
  );
  const snapshotFilterIds = Object.keys(persistedSnapshot).filter((filterId) =>
    isKnownFilterId(definitions, filterId),
  );

  if (normalizedFilterIds.length === 0 && snapshotFilterIds.length === 0) {
    return fallbackFilterIds;
  }

  return Array.from(new Set([...normalizedFilterIds, ...snapshotFilterIds]));
}

function writeScopeUrlFilterIds(
  config: UrlPersistenceConfig,
  filterIds: Array<string>,
): void {
  if (filterIds.length === 0) {
    writeJsonSearchParam(config.rowsParam, null);
    return;
  }

  writeJsonSearchParam(config.rowsParam, filterIds);
}

function createScopeUrlBindingPersister(
  config: UrlPersistenceConfig,
): FilterBindingPersister {
  return {
    read: ({ filterId }) => {
      const snapshot =
        readJsonSearchParam<Partial<Record<string, FilterBindingState>>>(
          config.filtersParam,
        ) ?? null;

      if (!snapshot) {
        return null;
      }

      return snapshot[filterId] ?? null;
    },
    write: (state, { filterId }) => {
      const snapshot =
        readJsonSearchParam<Partial<Record<string, FilterBindingState>>>(
          config.filtersParam,
        ) ?? {};

      if (state) {
        snapshot[filterId] = state;
      } else {
        delete snapshot[filterId];
      }

      if (Object.keys(snapshot).length === 0) {
        writeJsonSearchParam(config.filtersParam, null);
        return;
      }

      writeJsonSearchParam(config.filtersParam, snapshot);
    },
  };
}

export function createPageScopeUrlPersister(): FilterScopePersister {
  return {
    read: () =>
      readJsonSearchParam<Partial<Record<string, FilterBindingState>>>(
        PAGE_SCOPE_FILTERS_PARAM,
      ) ?? null,
    write: (snapshot) => {
      if (Object.keys(snapshot).length === 0) {
        writeJsonSearchParam(PAGE_SCOPE_FILTERS_PARAM, null);
        return;
      }

      writeJsonSearchParam(PAGE_SCOPE_FILTERS_PARAM, snapshot);
    },
  };
}

export function readPageScopeUrlFilterIds(
  definitions: Array<FilterDefinition>,
  fallbackFilterIds: Array<string>,
): Array<string> {
  return readScopeUrlFilterIds(
    {
      rowsParam: PAGE_SCOPE_ROWS_PARAM,
      filtersParam: PAGE_SCOPE_FILTERS_PARAM,
    },
    definitions,
    fallbackFilterIds,
  );
}

export function writePageScopeUrlFilterIds(filterIds: Array<string>): void {
  writeScopeUrlFilterIds(
    {
      rowsParam: PAGE_SCOPE_ROWS_PARAM,
      filtersParam: PAGE_SCOPE_FILTERS_PARAM,
    },
    filterIds,
  );
}

export function createPageScopeUrlBindingPersister(): FilterBindingPersister {
  return createScopeUrlBindingPersister({
    rowsParam: PAGE_SCOPE_ROWS_PARAM,
    filtersParam: PAGE_SCOPE_FILTERS_PARAM,
  });
}

export function readWidgetScopeUrlFilterIds(
  definitions: Array<FilterDefinition>,
  fallbackFilterIds: Array<string>,
): Array<string> {
  return readScopeUrlFilterIds(
    {
      rowsParam: WIDGET_SCOPE_ROWS_PARAM,
      filtersParam: WIDGET_SCOPE_FILTERS_PARAM,
    },
    definitions,
    fallbackFilterIds,
  );
}

export function writeWidgetScopeUrlFilterIds(filterIds: Array<string>): void {
  writeScopeUrlFilterIds(
    {
      rowsParam: WIDGET_SCOPE_ROWS_PARAM,
      filtersParam: WIDGET_SCOPE_FILTERS_PARAM,
    },
    filterIds,
  );
}

export function createWidgetScopeUrlBindingPersister(): FilterBindingPersister {
  return createScopeUrlBindingPersister({
    rowsParam: WIDGET_SCOPE_ROWS_PARAM,
    filtersParam: WIDGET_SCOPE_FILTERS_PARAM,
  });
}
