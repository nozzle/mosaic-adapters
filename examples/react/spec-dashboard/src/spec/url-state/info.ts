/** URL-parameter ownership and display information for the dashboard chrome. */
import { decodeSelectionUrlValue } from './selection-url';
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
      const descriptor = selections.getByParam(name);
      if (descriptor === undefined) {
        return null;
      }
      const interval = decodeSelectionUrlValue(descriptor, value);
      if (interval === null) {
        return null;
      }
      if (descriptor.dimensions === 1) {
        const [lo, hi] = interval as [number, number];
        return `${lo} – ${hi}`;
      }
      const [[xLo, xHi], [yLo, yHi]] = interval as [
        [number, number],
        [number, number],
      ];
      return `${descriptor.columns.x}: ${xLo} – ${xHi}; ${descriptor.columns.y}: ${yLo} – ${yHi}`;
    },
  };
}
