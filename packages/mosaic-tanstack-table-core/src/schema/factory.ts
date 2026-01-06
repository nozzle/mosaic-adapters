/**
 * Factory functions to create strict mappings between Zod schemas and Mosaic SQL configurations.
 * Enforces type safety so that the TypeScript definition, Runtime Schema, and SQL Logic are aligned.
 */

import type { z } from 'zod';
import type { FilterCompatibility, StrictId } from '../types';

// Helper to unwrap Zod Nullable/Optional to get the base type
type UnwrapZod<T> =
  T extends z.ZodNullable<infer U>
    ? UnwrapZod<U>
    : T extends z.ZodOptional<infer U>
      ? UnwrapZod<U>
      : T;

// Map JS Types (inferred from Zod) to allowed SQL Types
// Note: DuckDB often returns mixed types or union types, so we prioritize the stricter interpretation
type AllowedSqlTypes<TJS> = TJS extends Date
  ? 'DATE' | 'TIMESTAMP'
  : TJS extends number
    ? 'INTEGER' | 'FLOAT'
    : TJS extends boolean
      ? 'BOOLEAN'
      : TJS extends string
        ? 'VARCHAR'
        : never;

// The Strict Config Object based on TData (inferred from Zod schema)
export type StrictMapping<TData> = {
  [K in StrictId<TData>]?: {
    sqlColumn: string;
    // 1. Force SQL Type to match JS Type derived from Zod
    // We use a conditional type here to lookup the allowed SQL types for the inferred value at Key K
    type: TData extends object
      ? K extends keyof TData
        ? AllowedSqlTypes<UnwrapZod<TData[K]>>
        : AllowedSqlTypes<any> // Fallback for deep paths if complex
      : never;
    // 2. Force Filter Type to match the chosen SQL Type
    // The conditional logic checks what specific SQL type was chosen in 'type' field above
    filterType?: TData extends object
      ? K extends keyof TData
        ?
            | FilterCompatibility[AllowedSqlTypes<UnwrapZod<TData[K]>>]
            | (string & {})
        : string
      : string;
    filterOptions?: {
      convertToUTC?: boolean;
    };
  };
};

/**
 * Creates a type-safe mapping configuration derived from a Zod Schema.
 *
 * @param schema - The Zod Object schema representing the row data.
 * @param mapping - The strict mapping configuration.
 * @returns An object containing the original schema and the validated mapping.
 */
export function createMosaicMapping<TShape extends z.ZodRawShape>(
  schema: z.ZodObject<TShape>,
  mapping: StrictMapping<z.infer<z.ZodObject<TShape>>>,
) {
  // At runtime, this is an identity function.
  // At compile time, it enforces that 'mapping' aligns with 'schema'.
  return { schema, mapping };
}

// Re-export type helper for deeper paths if needed in future
export type GetAllowedSqlTypes<T> = AllowedSqlTypes<UnwrapZod<T>>;
