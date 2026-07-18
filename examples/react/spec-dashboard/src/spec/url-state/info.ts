/** URL-parameter ownership and display information for the dashboard chrome. */
import { decodeSelectionUrlValue } from './selection-url';
import { decodeParamValue } from './variable-url';
import type { FilterUrlInfo } from '../filter-url';
import type { SelectionUrlRegistry } from './selection-url';
import type { VariableUrlRegistry } from './variable-url';

export type ParamOwnership =
  | 'spec'
  | 'filter'
  | 'selection'
  | 'variable'
  | 'other';

export interface DashboardUrlInfo {
  classify: (name: string) => ParamOwnership;
  describe: (name: string, value: string) => string | null;
}

/** Render a decoded variable value for the popover (an array joins with `, `). */
function describeVariableValue(value: string): string | null {
  const decoded = decodeParamValue(value);
  if (decoded === null) {
    return null;
  }
  const { value: scalarOrArray } = decoded;
  if (Array.isArray(scalarOrArray)) {
    return scalarOrArray.map((entry) => String(entry)).join(', ');
  }
  return String(scalarOrArray);
}

/** Combine FilterSet, Selection, and Variable ownership into one chrome view. */
export function buildDashboardUrlInfo(
  filters: FilterUrlInfo,
  selections: SelectionUrlRegistry,
  variables: VariableUrlRegistry,
): DashboardUrlInfo {
  return {
    classify: (name) => {
      const filterOwnership = filters.classify(name);
      if (filterOwnership !== 'other') {
        return filterOwnership;
      }
      if (selections.getByParam(name) !== undefined) {
        return 'selection';
      }
      return variables.getByParam(name) === undefined ? 'other' : 'variable';
    },
    describe: (name, value) => {
      const filterDescription = filters.describe(name, value);
      if (filterDescription !== null) {
        return filterDescription;
      }
      if (variables.getByParam(name) !== undefined) {
        return describeVariableValue(value);
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
