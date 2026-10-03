import type { MosaicClient } from '@uwdata/mosaic-core';

/**
 * Consumer-owned metadata attached to a data client (`DataClientOptions.meta`)
 * — a label, a widget id, a route — for attributing its queries while
 * debugging. Never read by the library and never part of the query.
 */
export type DataClientMeta = Record<string, unknown>;

/**
 * Key under which a data client mirrors its `meta` onto the wrapped upstream
 * `MosaicClient` (`client.mosaicClient`), so coordinator-level observers —
 * which only ever see `MosaicClient`s, e.g. in a wrapped
 * `coordinator.updateClient` or a connector logger — can attribute a query to
 * the data client that issued it. Read it with {@link getClientMeta}.
 *
 * Registered with `Symbol.for`, so it is shared across duplicate copies of
 * this package. The property is a non-enumerable getter that always returns
 * the client's latest `meta` (`setMeta` included).
 */
export const MOSAIC_CLIENT_META: unique symbol = Symbol.for('@nozzleio/mosaic-core/client-meta');

/**
 * The `meta` of the data client wrapping `client`, or `undefined` when
 * `client` is not wrapped by a data client from this package or carries no
 * `meta`.
 */
export function getClientMeta(client: MosaicClient | null | undefined): DataClientMeta | undefined {
  if (client === null || client === undefined) {
    return undefined;
  }
  const meta: unknown = (client as unknown as Record<symbol, unknown>)[MOSAIC_CLIENT_META];
  if (typeof meta !== 'object' || meta === null) {
    return undefined;
  }
  return meta as DataClientMeta;
}

/**
 * Mirror a data client's latest `meta` onto its wrapped `MosaicClient` under
 * {@link MOSAIC_CLIENT_META}. `read` is called on every access, so later
 * `setMeta` calls need no re-mirroring.
 */
export function mirrorClientMeta(
  client: MosaicClient,
  read: () => DataClientMeta | undefined,
): void {
  Object.defineProperty(client, MOSAIC_CLIENT_META, {
    get: read,
    configurable: true,
    enumerable: false,
  });
}
