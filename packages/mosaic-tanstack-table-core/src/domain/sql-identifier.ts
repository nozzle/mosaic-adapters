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
   * Instead of a strict whitelist (Alphanumeric only), we now use a Blacklist.
   * We reject known SQL injection vectors and structure-breaking characters,
   * but accept almost anything else (including colons, spaces, starting numbers)
   * because the downstream SQL generator will wrap these in double quotes.
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
    // Note: We allow dots (.) as they are used for struct access paths.

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
