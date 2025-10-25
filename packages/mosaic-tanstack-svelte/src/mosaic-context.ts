// src/lib/mosaic-tanstack-adapter/mosaic-context.ts
// This file implements the Svelte Context API for Mosaic. It is responsible for
// instantiating all Mosaic Selections and making them available to child components.
import { setContext, getContext } from 'svelte';
import { Selection } from '@uwdata/mosaic-core';
import * as vg from '@uwdata/vgplot';

export interface SelectionConfig {
  name: string;
  type: 'intersect' | 'union' | 'single';
  options?: {
    empty?: boolean;
    cross?: boolean;
    include?: string[];
  };
}

interface MosaicContextType {
  getSelection: (name: string) => Selection | undefined;
}

const MOSAIC_CONTEXT_KEY = Symbol('mosaic-context');

function createSelectionRegistry(selectionConfigs: SelectionConfig[]): Map<string, Selection> {
    const registry = new Map<string, Selection>();
    let remainingConfigs = [...selectionConfigs];
    let createdInPass: boolean;

    do {
      createdInPass = false;
      const nextRemainingConfigs: SelectionConfig[] = [];

      for (const config of remainingConfigs) {
        const deps = config.options?.include || [];
        const allDepsMet = deps.every(depName => registry.has(depName));

        if (allDepsMet) {
          const includedSels = deps.map(depName => registry.get(depName)!);
          const opts = {
            ...config.options,
            ...(includedSels.length > 0 && { include: includedSels }),
          };

          let sel: Selection;
          switch (config.type) {
            case 'union': sel = vg.Selection.union(opts); break;
            case 'single': sel = vg.Selection.single(opts); break;
            default: sel = vg.Selection.intersect(opts); break;
          }
          
          registry.set(config.name, sel);
          createdInPass = true;
        } else {
          nextRemainingConfigs.push(config);
        }
      }
      remainingConfigs = nextRemainingConfigs;

      if (!createdInPass && remainingConfigs.length > 0) {
        const remainingNames = remainingConfigs.map(c => c.name).join(', ');
        throw new Error(`Could not resolve Mosaic Selection dependencies. Check for circular dependencies or missing definitions. Remaining: ${remainingNames}`);
      }
    } while (remainingConfigs.length > 0 && createdInPass);
    
    for (const config of selectionConfigs) {
        if (config.options?.empty === true) {
            const selection = registry.get(config.name);
            if (selection) {
                selection.update({ predicate: null });
            }
        }
    }

    return registry;
}


export function setMosaicContext(selectionConfigs: SelectionConfig[]) {
  const registry = createSelectionRegistry(selectionConfigs);
  
  const contextValue = {
    getSelection: (name: string): Selection | undefined => {
      const sel = registry.get(name);
      if (!sel) console.warn(`Mosaic Selection "${name}" was not found in the provider.`);
      return sel;
    }
  };

  setContext(MOSAIC_CONTEXT_KEY, contextValue);
  return contextValue;
}

export function useMosaicSelection(name: string): Selection {
  const context = getContext<MosaicContextType>(MOSAIC_CONTEXT_KEY);
  if (!context) {
    throw new Error('useMosaicSelection must be used within a component where setMosaicContext was called.');
  }
  const selection = context.getSelection(name);
  if (!selection) {
      throw new Error(`Mosaic Selection "${name}" is not registered in the Mosaic context.`);
  }
  return selection;
}