import type { QuerySource } from './types';

/**
 * Bundlers replace the `process.env.NODE_ENV` expression textually; the
 * declaration only types it for this module and never reaches the output.
 */
declare const process: { env: { NODE_ENV?: string } };

/**
 * True outside production builds. Reads `process.env.NODE_ENV` in the form
 * bundlers statically replace; when nothing replaced it and no `process`
 * global exists (unbundled browser ESM), it is treated as development.
 */
export function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

/**
 * Reject query sources the type system already excludes but a JavaScript
 * caller could still pass. A `string[]` is the dangerous one: mosaic-sql's
 * `Query.from(['main', 'events'])` renders a cross join of two tables rather
 * than the schema-qualified name the caller meant.
 */
export function assertQuerySource(source: unknown): void {
  if (Array.isArray(source)) {
    throw new TypeError(
      '[mosaic-core] A query source cannot be an array: mosaic-sql renders ' +
        "`Query.from(['main', 'events'])` as a cross join. Pass " +
        "`new TableRefNode(['main', 'events'])` from @uwdata/mosaic-sql for a " +
        'schema-qualified table.',
    );
  }
  if (typeof source === 'string' || typeof source === 'function') {
    return;
  }
  // Table references are duck-typed on their `table` name array rather than
  // checked with `isTableRef`: a node from a second copy of mosaic-sql fails
  // its `instanceof` test but still renders. Any other object (e.g. `{}`)
  // would reach `Query.from` and render an empty FROM.
  if (isTableRefLike(source)) {
    return;
  }
  throw new TypeError(
    `[mosaic-core] Invalid query source (${typeof source}): expected a table ` +
      'name, a TableRefNode, or a query factory.',
  );
}

function isTableRefLike(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) {
    return false;
  }
  return Array.isArray((source as { table?: unknown }).table);
}

/**
 * True when a plain-string query source contains a dot and so likely meant a
 * schema-qualified table: the string renders as ONE quoted identifier
 * (`"main.events"`). It is never split automatically, since a quoted table
 * name can legitimately contain dots.
 */
export function isDottedTableName(source: unknown): source is string {
  return typeof source === 'string' && source.includes('.');
}

/**
 * Warning text for a dotted plain-string query source.
 */
export function dottedTableNameWarning(source: string): string {
  const quote = (text: string): string => `'${text.replace(/'/g, "\\'")}'`;
  const parts = source.split('.').map(quote);
  return (
    `[mosaic-core] The query source "${source}" contains a dot but is a plain ` +
    `string, so it is quoted as ONE table name ("${source}"), not split into ` +
    'schema and table. For a schema-qualified table, pass ' +
    `\`new TableRefNode([${parts.join(', ')}])\` from @uwdata/mosaic-sql. If ` +
    `the table name really contains a dot, pass \`new TableRefNode(${quote(source)})\` ` +
    'to silence this warning.'
  );
}

/**
 * Whether two query sources are interchangeable. Strings and factories compare
 * by identity (factories are latest-ref, so a new closure is a new source);
 * table references compare by their rendered SQL, so a `TableRefNode` built
 * inline on every render is recognized as the same table.
 */
export function isSameQuerySource<TInputs extends object>(
  a: QuerySource<TInputs>,
  b: QuerySource<TInputs>,
): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  return String(a) === String(b);
}
