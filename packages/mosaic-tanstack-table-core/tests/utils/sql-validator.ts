/**
 * Test utilities for SQL validation using @polyglot-sql/sdk.
 *
 * Parses generated SQL strings through Polyglot's DuckDB parser to catch
 * syntax errors and extract structural metadata for assertions.
 */

import { expect } from 'vitest';
import { Dialect, format, parse, validate } from '@polyglot-sql/sdk';

const DIALECT = Dialect.DuckDB;

export interface SqlAnalysis {
  /** Whether the SQL parsed successfully. */
  valid: boolean;
  /** Parse error message, if any. */
  error?: string;
  /** Pretty-printed SQL. */
  formatted: string;
  /** Semantic warnings from validation. */
  warnings: Array<{ code: string; message: string }>;
  /** Raw SQL that was analyzed. */
  raw: string;
}

/**
 * Assert that a SQL string is syntactically valid DuckDB SQL.
 *
 * On failure, includes the SQL and error location in the assertion message
 * for easy debugging.
 */
export function expectValidSql(sql: string): void {
  const result = parse(sql, DIALECT);

  if (!result.success) {
    const location =
      result.errorLine != null
        ? ` (line ${result.errorLine}, col ${result.errorColumn})`
        : '';
    expect.fail(
      `Generated SQL is not valid${location}:\n` +
        `  Error: ${result.error}\n` +
        `  SQL:   ${sql}`,
    );
  }
}

/**
 * Analyze a SQL string and return structured metadata.
 *
 * Parses the SQL, validates semantics, and formats it. The returned object
 * can be used for structural assertions in tests.
 */
export function analyzeSql(sql: string): SqlAnalysis {
  const parseResult = parse(sql, DIALECT);

  if (!parseResult.success) {
    return {
      valid: false,
      error: parseResult.error,
      formatted: sql,
      warnings: [],
      raw: sql,
    };
  }

  const validationResult = validate(sql, DIALECT, { semantic: true });
  const warnings = validationResult.errors
    .filter((e) => e.severity === 'warning')
    .map((e) => ({ code: e.code, message: e.message }));

  const formatResult = format(sql, DIALECT);
  const formatted =
    formatResult.success && formatResult.sql
      ? formatResult.sql.join(';\n')
      : sql;

  return {
    valid: true,
    formatted,
    warnings,
    raw: sql,
  };
}
