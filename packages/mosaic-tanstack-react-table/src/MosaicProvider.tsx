// src/mosaic-tanstack-adapter/MosaicProvider.tsx
// This file introduces a React Context Provider for Mosaic. It is the core of the
// new architecture, responsible for instantiating and managing all Mosaic Selections
// based on a declarative configuration. It exposes a `useMosaicSelection` hook that
// allows any child component to access a selection by its string name, completely
// abstracting away the underlying Mosaic objects from the rest of the React application.
import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import * as vg from '@uwdata/vgplot';

// Define the shape of the context's value
interface MosaicContextType {
  getSelection: (name: string) => Selection | undefined;
}

const MosaicContext = createContext<MosaicContextType | null>(null);

// Define the shape of the declarative configuration for a selection
export interface SelectionConfig {
  name: string;
  type: 'intersect' | 'union' | 'single';
  options?: {
    empty?: boolean;
    include?: string[]; // Use names for dependencies
    cross?: boolean;
  };
}

interface MosaicProviderProps {
  selections: SelectionConfig[];
  children: ReactNode;
}

/**
 * The MosaicProvider is the root of the Mosaic integration for a React application.
 * It is responsible for instantiating and managing the lifecycle of all Mosaic
 * Selection objects based on a declarative configuration.
 *
 * It establishes a "selection graph" for the application, where selections can
 * depend on one another. This allows for the creation of powerful, composite
 * interaction states.
 *
 * A common and important pattern is the "raw vs. composite" selection for
 * interactions like hover or click. This involves:
 * 1. A "raw" selection (e.g., 'my_hover_raw') that receives a primitive
 *    predicate from an interactive component (like a table row hover).
 * 2. A "composite" selection (e.g., 'my_hover_highlight') that `include`'s both
 *    the raw selection AND the main dashboard filter context.
 * This pattern ensures that UI highlights are correctly filtered by the active
 * dashboard state.
 */
export function MosaicProvider({
  selections: selectionConfigs,
  children,
}: MosaicProviderProps) {
  // Use `useState` with a function to ensure this complex initialization runs only once.
  const [selectionRegistry] = useState(() => {
    const registry = new Map<string, Selection>();
    let remainingConfigs = [...selectionConfigs];
    let createdInPass: boolean;

    // Use a multi-pass approach to respect the `include` dependency graph.
    // This loop continues as long as we are successfully creating selections.
    do {
      createdInPass = false;
      const nextRemainingConfigs: SelectionConfig[] = [];

      for (const config of remainingConfigs) {
        const deps = config.options?.include || [];
        const allDepsMet = deps.every((depName) => registry.has(depName));

        if (allDepsMet) {
          // All dependencies for this selection are already in the registry.
          // We can now create it.
          const includedSels = deps.map((depName) => registry.get(depName)!);
          const opts = {
            ...config.options,
            ...(includedSels.length > 0 && { include: includedSels }),
          };

          let sel: Selection;
          switch (config.type) {
            case 'union':
              // @ts-expect-error Argument of type '{ include?: string[] | Selection[] | undefined; empty?: boolean; cross?: boolean; }' is not assignable to parameter of type 'SelectionOptions'
              sel = vg.Selection.union(opts);
              break;
            case 'single':
              // @ts-expect-error Argument of type '{ include?: string[] | Selection[] | undefined; empty?: boolean; cross?: boolean; }' is not assignable to parameter of type 'SelectionOptions'
              sel = vg.Selection.single(opts);
              break;
            default:
              // @ts-expect-error Argument of type '{ include?: string[] | Selection[] | undefined; empty?: boolean; cross?: boolean; }' is not assignable to parameter of type 'SelectionOptions'
              sel = vg.Selection.intersect(opts);
              break;
          }

          registry.set(config.name, sel);
          createdInPass = true;
        } else {
          // Dependencies not met, try again in the next pass.
          nextRemainingConfigs.push(config);
        }
      }
      remainingConfigs = nextRemainingConfigs;

      if (!createdInPass && remainingConfigs.length > 0) {
        const remainingNames = remainingConfigs.map((c) => c.name).join(', ');
        throw new Error(
          `Could not resolve Mosaic Selection dependencies. Check for circular dependencies or missing definitions. Remaining: ${remainingNames}`,
        );
      }
    } while (remainingConfigs.length > 0 && createdInPass);

    // --- START: IMPLEMENTED CHANGE ---
    // This initialization sweep synchronously updates any selection intended to be "empty"
    // by default. This sends an initial `predicate: null` update to the coordinator,
    // which resolves to `WHERE FALSE`, preventing an initial unfiltered query.
    // This eliminates the initialization race condition.
    for (const config of selectionConfigs) {
      if (config.options?.empty === true) {
        const selection = registry.get(config.name);
        if (selection) {
          // @ts-expect-error Argument of type '{ predicate: null; }' is not assignable to parameter of type 'SelectionClause'
          selection.update({ predicate: null });
        }
      }
    }
    // --- END: IMPLEMENTED CHANGE ---

    return registry;
  });

  // The function provided to the context to retrieve selections.
  const getSelection = (name: string) => {
    const sel = selectionRegistry.get(name);
    if (!sel) {
      console.warn(`Mosaic Selection "${name}" was not found in the provider.`);
    }
    return sel;
  };

  React.useEffect(() => {
    console.debug(selectionRegistry);
  }, []);

  return (
    <MosaicContext.Provider value={{ getSelection }}>
      {children}
    </MosaicContext.Provider>
  );
}

/**
 * Custom hook for components to easily access a Mosaic Selection by name.
 * This is the public API for the adapter's consumers.
 */
export function useMosaicSelection(name: string): Selection {
  const context = useContext(MosaicContext);
  if (!context) {
    throw new Error('useMosaicSelection must be used within a MosaicProvider');
  }
  const selection = context.getSelection(name);
  if (!selection) {
    throw new Error(
      `Mosaic Selection "${name}" is not registered in the MosaicProvider.`,
    );
  }
  return selection;
}
