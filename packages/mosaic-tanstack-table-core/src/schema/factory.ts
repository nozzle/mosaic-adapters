/**
 * Factory functions to create strict mappings.
 */

import type { MosaicColumnMapping } from '../types';

/**
 * Creates a type-safe mapping configuration.
 *
 * @param mapping - The strict mapping configuration.
 * @returns The mapping object (Identity function).
 */
export function createMosaicMapping<TData>(
  mapping: MosaicColumnMapping<TData>,
): MosaicColumnMapping<TData> {
  return mapping;
}
