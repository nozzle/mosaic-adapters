/** URL-parameter ownership and display information for the dashboard chrome. */
import { decodeNumericInterval } from './selection-url';
import type { FilterUrlInfo } from '../filter-url';
import type { SelectionUrlRegistry } from './selection-url';

export type ParamOwnership = 'spec' | 'filter' | 'selection' | 'other';

export interface DashboardUrlInfo {
  classify: (name: string) => ParamOwnership;
  describe: (name: string, value: string) => string | null;
}

/** Combine FilterSet and standalone-Selection ownership into one chrome view. */
export function buildDashboardUrlInfo(
  filters: FilterUrlInfo,
  selections: SelectionUrlRegistry,
): DashboardUrlInfo {
  return {
    classify: (name) => {
      const filterOwnership = filters.classify(name);
      if (filterOwnership !== 'other') {
        return filterOwnership;
      }
      return selections.getByParam(name) === undefined ? 'other' : 'selection';
    },
    describe: (name, value) => {
      const filterDescription = filters.describe(name, value);
      if (filterDescription !== null) {
        return filterDescription;
      }
      if (selections.getByParam(name) === undefined) {
        return null;
      }
      const interval = decodeNumericInterval(value);
      return interval === null ? null : `${interval[0]} – ${interval[1]}`;
    },
  };
}
