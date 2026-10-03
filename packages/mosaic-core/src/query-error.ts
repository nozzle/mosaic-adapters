import { QueryError } from '@uwdata/mosaic-core';

/**
 * The reasons Mosaic's `QueryManager` rejects a request it never ran to
 * completion: `coordinator.cancel(requests)` rejects with `'Canceled'`,
 * `coordinator.clear()` (with or without `clients`) with `'Cleared'`.
 * Upstream rejects with these bare strings rather than a typed error.
 */
const CANCELLATION_REASONS: ReadonlySet<string> = new Set(['Canceled', 'Cleared']);

/** A bare cancellation string, or an `Error` whose message is one. */
function isCancellationReason(value: unknown): boolean {
  if (typeof value === 'string') {
    return CANCELLATION_REASONS.has(value);
  }
  if (value instanceof Error) {
    return CANCELLATION_REASONS.has(value.message);
  }
  return false;
}

/**
 * True when `error` is Mosaic's way of saying a query was cancelled rather
 * than failed — `coordinator.cancel(...)` or `coordinator.clear(...)`
 * rejecting a request before it completed.
 *
 * Matches every shape the rejection takes on its way to a consumer:
 * - the bare `'Canceled'` / `'Cleared'` string a `coordinator.query()` or
 *   `coordinator.exec()` promise rejects with;
 * - an `Error` carrying that message;
 * - a `QueryError` (what a client's `queryError` hook receives) whose
 *   `cause` is one of the above.
 *
 * Use it instead of string-matching Mosaic internals, e.g. to retry a load
 * that a connector reset cleared, or to skip rendering a cancellation as a
 * failure.
 */
export function isQueryCancellation(error: unknown): boolean {
  if (error instanceof QueryError) {
    return isCancellationReason(error.cause);
  }
  return isCancellationReason(error);
}

/** Display-ready parts of a query failure (see {@link describeQueryError}). */
export interface QueryErrorDescription {
  /**
   * The underlying failure message — for a `QueryError`, its `cause`'s
   * message, without the `"\n\nSQL Query: …"` suffix upstream appends to
   * `QueryError.message`.
   */
  message: string;
  /** The SQL the coordinator issued, when the error is a `QueryError`. */
  sql?: string;
  /** The underlying cause (`Error.cause`), when there is one. */
  cause?: unknown;
}

/** Message of an arbitrary rejection value. */
function messageOf(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

/**
 * Split a query failure into display-ready parts, so a UI can show the
 * message and the SQL separately instead of rendering `error.message` (which,
 * for a `QueryError`, embeds the whole SQL query).
 *
 * - `QueryError` → `{ message: <cause message>, sql, cause }`;
 * - any other `Error` → `{ message, cause? }`;
 * - any other non-nullish value (e.g. a bare string rejection) →
 *   `{ message: String(value) }`.
 *
 * Returns `null` for `null`/`undefined` — i.e. "no error" — so it can be fed a
 * store's `error` field directly. A cancellation is described like any other
 * value; check {@link isQueryCancellation} first to treat it differently.
 */
export function describeQueryError(error: unknown): QueryErrorDescription | null {
  if (error === null || error === undefined) {
    return null;
  }
  if (error instanceof QueryError) {
    return { message: messageOf(error.cause), sql: error.sql, cause: error.cause };
  }
  if (error instanceof Error) {
    if (error.cause === undefined) {
      return { message: error.message };
    }
    return { message: error.message, cause: error.cause };
  }
  return { message: String(error) };
}
