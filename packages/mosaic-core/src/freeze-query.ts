import { ParamNode, isNode } from '@uwdata/mosaic-sql';
import type { Query as MosaicQuery, ParamLike } from '@uwdata/mosaic-sql';

/**
 * A static stand-in for a Param: it holds the value the Param had when the
 * query was built and never changes or notifies.
 */
function snapshotParam(param: ParamLike): ParamLike {
  const value = param.value;
  return {
    value,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

/**
 * Copy-on-write walk that swaps every `ParamNode` for one bound to a
 * snapshot of its Param. Nodes (and arrays) with no Param below them are
 * returned as-is, so a query without Params is shared, not copied.
 *
 * The walk visits every own enumerable field of every AST node rather than
 * upstream's `recurse` table, which omits fields that can hold a Param (for
 * example `_limit` / `_offset`, as in ``.limit(sql`${param}`)``).
 */
function freezeValue(value: unknown, memo: Map<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const next: Array<unknown> = [];
    let changed = false;
    for (const item of value as Array<unknown>) {
      const frozen = freezeValue(item, memo);
      if (frozen !== item) {
        changed = true;
      }
      next.push(frozen);
    }
    return changed ? next : value;
  }
  if (!isNode(value)) {
    return value;
  }
  if (memo.has(value)) {
    return memo.get(value);
  }
  if (value instanceof ParamNode) {
    const frozen = new ParamNode(snapshotParam(value.param));
    memo.set(value, frozen);
    return frozen;
  }
  // Treat a node as unchanged while it is being visited, so a (never
  // expected) cycle terminates instead of recursing forever.
  memo.set(value, value);
  const changes: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(value)) {
    const field = (value as unknown as Record<string, unknown>)[key];
    const frozen = freezeValue(field, memo);
    if (frozen !== field) {
      changes[key] = frozen;
      changed = true;
    }
  }
  if (!changed) {
    return value;
  }
  const copy = Object.assign(
    Object.create(Object.getPrototypeOf(value) as object) as object,
    value,
    changes,
  );
  memo.set(value, copy);
  return copy;
}

/**
 * Freeze a built main query at its build-time SQL, `sql`, without mutating
 * the consumer's query object.
 *
 * A query that interpolates a live Param (``sql`… ${param}` ``,
 * `column(param)`, …) re-renders with the Param's *current* value every
 * time it is stringified. Upstream renders the query
 * object again long after the build: at send time (`QueryManager.submit`),
 * when it wraps a failure (`Coordinator.updateClient` builds the
 * `QueryError` from it), when the query consolidator merges it with other
 * queries (`clone()` plus its SELECT expressions, rendered when the merged
 * request is sent) and when it caches a result by SQL. A Param change while
 * a request is queued or in flight would make that request read as the
 * newer one — its `QueryError.sql` would match the newer in-flight entry,
 * and its result could be sent and cached under SQL it was not computed
 * from.
 *
 * Two layers keep every rendering at the build-time text:
 * 1. Every `ParamNode` in the AST is rebound to a snapshot of its Param's
 *    value (copy-on-write: only the nodes on the path to a Param are
 *    copied, the rest is shared). Anything upstream derives from the query
 *    — `clone()`, `deepClone`, SELECT expressions read by the consolidator
 *    or the pre-aggregator — renders the build-time values, while
 *    `instanceof` checks and AST reads keep working.
 * 2. The returned root is a per-build shallow copy (same prototype, same
 *    own fields) with a non-enumerable own `toString` that returns `sql`
 *    when called without a code generator. This guarantees the request SQL
 *    and `QueryError.sql` equal the SQL recorded for the request even if a
 *    Param hides somewhere the walk cannot see (a Param passed as a raw
 *    literal value, for instance). An explicit code-generator argument
 *    renders the frozen AST through it.
 *
 * Assumption (re-check when bumping the Mosaic peer range): upstream query
 * `clone()` copies only own enumerable fields (`Object.assign(new
 * SelectQuery(), this)`, rest-spread for `PivotQuery` / `SetOperation`), so
 * a clone drops the pinned `toString` and is an ordinary query over the
 * frozen AST. A plain `Object.create(query)` view would clone to an empty
 * query, since all of its fields would live on the prototype.
 */
export function freezeQuerySql(query: MosaicQuery, sql: string): MosaicQuery {
  const frozen = freezeValue(query, new Map()) as MosaicQuery;
  const pinned = Object.assign(
    Object.create(Object.getPrototypeOf(frozen) as object) as MosaicQuery,
    frozen,
  );
  Object.defineProperty(pinned, 'toString', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (visitor?: Parameters<MosaicQuery['toString']>[0]): string => {
      if (visitor === undefined) {
        return sql;
      }
      return frozen.toString(visitor);
    },
  });
  return pinned;
}
