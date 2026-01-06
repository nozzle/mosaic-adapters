/**
 * Value Object for SQL Identifiers.
 * Ensures that any string used as a column or table name in generated SQL
 * adheres to strict safety rules, preventing accidental injection or invalid syntax.
 */
export class SqlIdentifier {
  // Brand property to ensure nominal typing.
  // We use void to verify shape without runtime overhead or static restrictions.
  declare private _brand: void;

  private constructor(public readonly raw: string) {}

  /**
   * Validates and creates a SqlIdentifier.
   * Allowed characters: Alphanumeric, underscores, and dots (for struct access `table.col`).
   * Must start with a letter or underscore.
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

    // Strict whitelist regex to prevent SQL injection
    // Matches: "column", "table.column", "_private", "data.nested.value"
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(trimmed)) {
      throw new Error(
        `[SqlIdentifier] Unsafe or invalid SQL Identifier: "${trimmed}"`,
      );
    }

    return new SqlIdentifier(trimmed);
  }

  toString(): string {
    return this.raw;
  }
}
