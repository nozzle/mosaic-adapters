// examples/react/trimmed/src/useMosaicReactTable.tsx
// Updated to pass `internalFilter` property to the Core class.
import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import { useStore } from '@tanstack/react-store';
import type {
  MosaicDataTable,
  MosaicDataTableOptions,
} from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core/trimmed';

// Robust deep equality check for config objects
// Duplicated here to ensure the Hook has the same logic as the Core
function isDeepEqual(obj1: any, obj2: any) {
  // Handle null/undefined
  if (obj1 === obj2) return true;
  if (!obj1 || !obj2) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

  // Special handling for arrays (like columns)
  if (Array.isArray(obj1)) {
    if (!Array.isArray(obj2) || obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!isDeepEqual(obj1[i], obj2[i])) return false;
    }
    return true;
  }

  // Handle Objects
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    const val1 = obj1[key];
    const val2 = obj2[key];

    // For functions (renderers), compare source code string
    if (typeof val1 === 'function' && typeof val2 === 'function') {
      if (val1.toString() !== val2.toString()) return false;
      continue;
    }

    // For Mosaic Selections/Params/Coordinators, assume Reference Equality
    if (
      key === 'filterBy' ||
      key === 'internalFilter' ||
      key === 'coordinator' ||
      key === 'table'
    ) {
      if (val1 !== val2) return false;
      continue;
    }

    if (!isDeepEqual(val1, val2)) return false;
  }

  return true;
}

function useDeepCompareEffect(
  callback: React.EffectCallback,
  dependencies: any[],
) {
  const firstRender = React.useRef(true);
  const previousDeps = React.useRef(dependencies);

  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      callback();
      return;
    }

    const isSame = dependencies.every((dep, index) => {
      return isDeepEqual(dep, previousDeps.current[index]);
    });

    if (!isSame) {
      callback();
    }

    previousDeps.current = dependencies;
  }, dependencies);
}

export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue> & { internalFilter?: any }, // Allow internalFilter prop
): {
  tableOptions: TableOptions<TData>;
  client: MosaicDataTable<TData, TValue>;
} {
  // Lazy initialization of the client to prevent "ghost" instances on every render.
  // This ensures only ONE client is ever created for the lifetime of this component.
  const clientRef = React.useRef<MosaicDataTable<TData, TValue> | null>(null);
  if (!clientRef.current) {
    clientRef.current = createMosaicDataTableClient<TData, TValue>(options);
  }
  const client = clientRef.current;

  // Subscribe to the client's store to get framework-land updates.
  const store = useStore(client.store);

  // Get the current table options from the client.
  const tableOptions = React.useMemo(
    () => client.getTableOptions(store),
    [store],
  );

  // Use deep comparison for options update to avoid infinite loops
  // caused by referential instability of the options object from parent
  useDeepCompareEffect(() => {
    // Update the client options when they truly change.
    client.updateOptions(options);
  }, [options]);

  React.useEffect(() => {
    // Connect the client to the coordinator on mount, and disconnect on unmount.
    const unsub = client.connect();
    return unsub;
  }, []);

  return { tableOptions, client };
}