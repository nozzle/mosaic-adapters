import * as mSql from '@uwdata/mosaic-sql';
import type { ExprNode } from '@uwdata/mosaic-sql';

/**
 * Value Object for SQL Identifiers.
 * Ensures that any string used as a column or table name in generated SQL
 * adheres to safety rules to prevent injection, while allowing flexible
 * real-world schema names (e.g. Socrata's ":id", spaces, dashes).
 */
export class SqlIdentifier {
  // Brand property to ensure nominal typing.
  declare private _brand: void;

  private constructor(public readonly raw: string) {}

  /**
   * Validates and creates a SqlIdentifier.
   *
   * RELAXED VALIDATION STRATEGY:
   * Instead of a strict whitelist (Alphanumeric only), we use a blacklist:
   * known SQL injection vectors and structure-breaking characters are
   * rejected, almost anything else (colons, spaces, leading numbers) is
   * accepted because the downstream SQL generator wraps identifiers in
   * double quotes.
   */
  static from(input: string): SqlIdentifier {
    if (typeof input !== 'string') {
      throw new Error(
        `[SqlIdentifier] Input must be a string. Received: ${typeof input}`,
      );
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new Error('[SqlIdentifier] Identifier cannot be empty.');
    }

    // BLOCKLIST:
    // 1. Double Quotes ("): Would break out of "column_name" wrapping.
    // 2. Semicolons (;): Statement termination injection.
    // 3. Comments (-- or /*): Hiding query parts.
    // 4. Null Bytes / Control Chars: binary corruption.
    // Note: Dots (.) are allowed — they are struct access paths.

    // eslint-disable-next-line no-control-regex
    const unsafePattern = /["\0\x08\x09\x1a\n\r;]|(--)|(\/\*)/;

    if (unsafePattern.test(trimmed)) {
      throw new Error(
        `[SqlIdentifier] Unsafe SQL Identifier detected. Contains prohibited characters: "${trimmed}"`,
      );
    }

    return new SqlIdentifier(trimmed);
  }

  toString(): string {
    return this.raw;
  }
}

/**
 * Escapes LIKE/ILIKE pattern metacharacters in user input so patterns match
 * literally (used with `ESCAPE '\'`).
 */
export function escapeSqlLikePattern(input: string): string {
  // Replace backslash first to avoid double-escaping later replacements.
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Builds a (possibly struct-path) column access expression:
 * `"related_phrase"."phrase"` from `related_phrase.phrase`, with each part
 * quoted through mosaic-sql's column nodes.
 */
export function createStructAccess(column: SqlIdentifier): ExprNode {
  const columnPath = column.toString();

  if (!columnPath.includes('.')) {
    return mSql.column(columnPath);
  }

  const parts = columnPath.split('.');
  const [first, ...rest] = parts;

  if (!first) {
    throw new Error(`Invalid column path: ${columnPath}`);
  }

  return rest.reduce<ExprNode>(
    (acc, part) => mSql.sql`${acc}.${mSql.column(part)}`,
    mSql.column(first),
  );
}

/**
 * Creates a typed SQL accessor using DuckDB's TRY_CAST, allowing flexible
 * filtering (e.g. a numeric filter on a string column) without runtime
 * errors: failed conversions become NULL instead of throwing.
 */
export function createTypedAccess(
  colExpr: ExprNode,
  targetType: 'string' | 'number' | 'date' | 'boolean',
): ExprNode {
  if (targetType === 'number') {
    return mSql.sql`TRY_CAST(${colExpr} AS DOUBLE)`;
  }
  if (targetType === 'date') {
    return mSql.sql`TRY_CAST(${colExpr} AS TIMESTAMP)`;
  }
  return colExpr;
}
