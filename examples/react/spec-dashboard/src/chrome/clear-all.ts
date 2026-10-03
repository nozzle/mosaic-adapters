import type { Topology } from '@nozzleio/react-mosaic';

/**
 * The active-filter bar's "Clear All": `topology.reset()` inside an opt-in
 * `topology.batch()`.
 *
 * `reset()` clears every owned FilterSet spec (each spec's clause on each of
 * its targets) and every standalone Selection such as the volume brush, and
 * restores owned variables to their defaults. Unbatched, each cleared clause is
 * its own update of the crossfilter `page` context and its derived contexts,
 * so every widget re-queries once per cleared clause, and the intermediate
 * rounds show combinations nobody asked for (e.g. the brush already gone but
 * the phrase filter still applied). Batched, every touched Selection emits once
 * with the final state, the FilterSet syncs its store once (one URL write) and
 * `activeClauses` refreshes once.
 *
 * Variables are Mosaic Params, which a batch never defers: they are restored
 * to their defaults as usual. An idle Param emits before the batched
 * Selections do; one still dispatching an earlier update queues its default
 * and may deliver it after them.
 */
export function clearAllFilters(topology: Topology): void {
  topology.batch(() => {
    topology.reset();
  });
}
