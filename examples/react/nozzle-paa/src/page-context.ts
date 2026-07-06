/**
 * The page's Selection topology, declared as data.
 *
 * The whole page is driven by a single hoisted {@link TopologyConfig} — a pure
 * JSON document naming every Selection on the page — resolved to live instances
 * by `useTopology` (see {@link usePageTopology}) under a `MosaicTopologyProvider`.
 * Widgets resolve their `filterBy` / target selections by *ref* through the
 * provider (`useMosaicSelectionRef`, or the app-derived contexts below), never
 * by importing Selection instances.
 *
 * ## What is declared vs. what is code
 *
 * - **`filters` (`filter-set`)** — THE page filter set. Its nine targets (`where`
 *   plus the four `having:<card>` / four `members:<card>` overlays) each become
 *   an addressable target Selection resolvable as `filters.<target>`. The
 *   code-only parts of the set — the custom `metric-threshold` / `min-domains`
 *   kinds and the URL `persist`er — travel in the options bag
 *   ({@link topologyOptions}), keyed by the entry name. Every dashboard
 *   filter is a {@link FilterSpec} on this set.
 * - **`spotlight` (`single`)** — a standalone, topology-owned Selection the
 *   "Domain spotlight" quick-filter publishes a point clause into *directly*
 *   (bypassing the FilterSet). It is the page's one genuinely FOREIGN clause
 *   source: it surfaces on `topology.activeClauses` and drives the foreign half
 *   of the active-filter-bar's chip recipe (see `active-filter-bar.tsx`).
 *
 * ## The crossfilter read-contexts are `external` (escape hatch)
 *
 * The KPI/detail/facet/summary widgets read a set of *composite* contexts —
 * `page` (WHERE + every card's membership overlay + spotlight) and one
 * `summaryFilterBy:<card>` per card (the page minus that card's own
 * membership). These MUST be `Selection.crossfilter({ include })`, never
 * `intersect`: per-client clause exclusion (the facet self-exclusion and summary
 * self-exclusion, wired through `filterSet.set(spec, { clients })` and row-select
 * publishing) is governed by the OUTER composite's `cross` flag — an `intersect`
 * composite silently disables it (proven: `intersect.predicate(ownClient)` still
 * returns the client's own predicate, `crossfilter.predicate(ownClient)` returns
 * `undefined`).
 *
 * The closed declaration vocabulary's `compose` type yields an `intersect`
 * Selection, so these crossfilter composites are not expressible as
 * declarations. They are declared `external` — so the config stays the complete
 * namespace document — with empty `Selection.crossfilter()` instances supplied
 * at construction and wired to the topology's resolved targets immediately after
 * ({@link wirePageContexts}). This is the sanctioned escape hatch: exotic,
 * hand-wired composites the library does not model, still named in the config so
 * `validNames` is total. `page` doubles as the FilterSet's subquery `context`.
 */
import { Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  buildSubqueryPredicate,
  builtinFilterKinds,
  createStructAccess,
  subqueryFilterKind,
} from '@nozzleio/react-mosaic';
import { urlPersister } from './filter-url';
import type {
  FilterKind,
  FilterKindArgs,
  OperatorDescriptor,
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '@nozzleio/react-mosaic';
import type { ExprNode } from '@uwdata/mosaic-sql';

export const tableName = 'questions';

export type SummaryTableId = 'phrase' | 'question' | 'domain' | 'url';

const SUMMARY_IDS: Array<SummaryTableId> = [
  'phrase',
  'question',
  'domain',
  'url',
];

function perSummary<T>(
  build: (id: SummaryTableId) => T,
): Record<SummaryTableId, T> {
  return Object.fromEntries(SUMMARY_IDS.map((id) => [id, build(id)])) as Record<
    SummaryTableId,
    T
  >;
}

/** The FilterSet target name a card's HAVING clause routes to. */
export function havingTarget(id: SummaryTableId): string {
  return `having:${id}`;
}

/** The FilterSet target name a card's membership subquery routes to. */
export function membersTarget(id: SummaryTableId): string {
  return `members:${id}`;
}

// ── Metric-threshold custom kind ─────────────────────────────────────────────

/**
 * Static per-card metric config the metric-threshold kind closes over: the
 * group-by column (spec column + membership group key) and the HAVING
 * left-hand-side aggregate expression.
 */
interface MetricCardConfig {
  groupBy: string;
  aggExpr: () => ExprNode;
}

const METRIC_CARDS: Record<SummaryTableId, MetricCardConfig> = {
  phrase: { groupBy: 'phrase', aggExpr: () => mSql.max('search_volume') },
  question: { groupBy: 'related_phrase.phrase', aggExpr: () => mSql.count() },
  domain: { groupBy: 'domain', aggExpr: () => mSql.count() },
  url: { groupBy: 'url', aggExpr: () => mSql.count() },
};

/** Chip / control labels per card (parity with the legacy registry). */
export const metricChipLabels: Record<SummaryTableId, string> = {
  phrase: 'Search Vol',
  question: 'SERP Appears',
  domain: 'Domain Answers',
  url: 'URL Answers',
};

/** Parses `metric:<card>` → the card id, or null when malformed. */
function metricCardId(specId: string): SummaryTableId | null {
  const suffix = specId.startsWith('metric:') ? specId.slice(7) : '';
  return (SUMMARY_IDS as Array<string>).includes(suffix)
    ? (suffix as SummaryTableId)
    : null;
}

/**
 * The operator vocabulary the `metric-threshold` kind interprets — a custom
 * kind self-describing its operators exactly like the built-ins (issue #180),
 * so a UI (e.g. the filter builder) can enumerate them. Descriptive only; the
 * `emit` below remains the source of truth for behavior.
 */
const METRIC_THRESHOLD_OPERATORS: ReadonlyArray<OperatorDescriptor> = [
  { id: 'gt', label: 'greater than', arity: 'unary' },
  { id: 'lt', label: 'less than', arity: 'unary' },
];

/**
 * `metric-threshold` kind. One spec per card (`metric:<card>`) with an operator
 * (`gt`/`lt`) and a numeric value emits two clauses:
 *
 * 1. `having:<card>` — `<agg> >/< N` for the card's own grouped query.
 * 2. `members:<card>` — `<groupKey> IN (SELECT <groupKey> FROM questions
 *    WHERE <page predicate> GROUP BY 1 HAVING <agg cmp N>)`, so every sibling
 *    narrows to the matching group subset. Reading `contextPredicate` registers
 *    the spec as context-dependent, so the set rebuilds this on page changes.
 */
export const metricThresholdKind: FilterKind = {
  operators: METRIC_THRESHOLD_OPERATORS,
  emit: (args: FilterKindArgs) => {
    const cardId = metricCardId(args.spec.id);
    if (cardId === null) {
      return [];
    }
    const operator = args.spec.operator;
    const value = args.spec.value;
    if (
      (operator !== 'gt' && operator !== 'lt') ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return [];
    }

    const card = METRIC_CARDS[cardId];
    const compare = operator === 'lt' ? mSql.lt : mSql.gt;
    const havingPredicate = compare(card.aggExpr(), mSql.literal(value));

    const groupKey = createStructAccess(SqlIdentifier.from(card.groupBy));
    const subquery = mSql.Query.select({ member: groupKey })
      .from(tableName)
      .groupby(groupKey)
      .having(compare(card.aggExpr(), mSql.literal(value)));
    const contextPredicate = args.contextPredicate;
    if (contextPredicate !== null) {
      subquery.where(contextPredicate);
    }

    return [
      {
        target: havingTarget(cardId),
        clause: { value, predicate: havingPredicate },
      },
      {
        target: membersTarget(cardId),
        clause: {
          value,
          predicate: buildSubqueryPredicate({
            column: card.groupBy,
            query: subquery,
          }),
        },
      },
    ];
  },
  formatValue: (spec) =>
    `${spec.operator === 'lt' ? '<' : '>'} ${String(spec.value)}`,
};

// ── Min-domains custom kind ──────────────────────────────────────────────────

/**
 * The `min-domains` operator vocabulary — a single `gte` ("at least N")
 * operator, self-described so the filter builder can enumerate it exactly like
 * the built-in kinds (issue #180). The subquery `emit` below is the source of
 * truth for behavior; this is descriptive only.
 */
const MIN_DOMAINS_OPERATORS: ReadonlyArray<OperatorDescriptor> = [
  { id: 'gte', label: 'at least', arity: 'unary' },
];

/**
 * `min-domains` — keep rows whose question appears on at least N distinct
 * domains:
 *
 *   related_phrase.phrase IN (
 *     SELECT related_phrase.phrase FROM questions
 *     GROUP BY 1 HAVING count(DISTINCT domain) >= N)
 */
export const minDomainsKind: FilterKind = {
  operators: MIN_DOMAINS_OPERATORS,
  ...subqueryFilterKind((args) => {
    const minDomains = Number(args.spec.value);
    if (!Number.isFinite(minDomains) || minDomains <= 0) {
      return null;
    }
    const questionExpr = mSql.sql`"related_phrase"."phrase"`;
    return mSql.Query.select({ question: questionExpr })
      .from(tableName)
      .groupby(questionExpr)
      .having(mSql.gte(mSql.count('domain').distinct(), minDomains));
  }),
  formatValue: (spec) => `≥ ${String(spec.value)}`,
};

/**
 * The kind registry the page filter set resolves through: the built-ins merged
 * with this app's custom kinds. Exported so the filter builder can enumerate a
 * kind's self-describing `operators` metadata for its operator dropdown
 * (`kindRegistry[kind]?.operators`) — the SAME merged map the set uses, so what
 * the builder offers is exactly what the set can resolve.
 */
export const kindRegistry: Record<string, FilterKind> = {
  ...builtinFilterKinds,
  'metric-threshold': metricThresholdKind,
  'min-domains': minDomainsKind,
};

// ── The topology config (pure JSON, hoisted) ─────────────────────────────────

/** The FilterSet entry name in the topology config. */
export const FILTERS_ENTRY = 'filters';

/** The foreign-source ("Domain spotlight") entry name in the topology config. */
export const SPOTLIGHT_ENTRY = 'spotlight';

/** The second foreign-source ("Search Volume" brush) entry name in the topology config. */
export const VOLUME_BRUSH_ENTRY = 'volumeBrush';

/** The column the volume brush ranges over. */
export const VOLUME_BRUSH_COLUMN = 'search_volume';

/** The page-wide crossfilter composite entry name (external). */
export const PAGE_ENTRY = 'page';

/** The volume-brush read-context entry name (external): the page minus its own clause. */
export const VOLUME_BRUSH_CONTEXT_ENTRY = 'volumeBrushFilterBy';

/** The per-card summary read-context entry name (external). */
export function summaryContextEntry(id: SummaryTableId): string {
  return `summaryFilterBy:${id}`;
}

/**
 * The FilterSet's target map: `where`, plus a `having:<card>` and a
 * `members:<card>` per summary card. Every target is a `crossfilter` so the
 * clause-`clients` self-exclusion the facet/summary controls rely on resolves
 * correctly wherever a widget reads a target directly.
 */
function filterSetTargets(): Record<string, 'crossfilter'> {
  const targets: Record<string, 'crossfilter'> = { where: 'crossfilter' };
  for (const id of SUMMARY_IDS) {
    targets[havingTarget(id)] = 'crossfilter';
    targets[membersTarget(id)] = 'crossfilter';
  }
  return targets;
}

/**
 * THE page topology, declared as data. Hoisted (module scope) so its object
 * identity is stable — `useTopology` keys recreation on identity, so a stable
 * config means one topology for the page's lifetime.
 */
function externalSummaryContexts(): TopologyConfig {
  const entries: TopologyConfig = {};
  for (const id of SUMMARY_IDS) {
    // reset: false — a derived read-context holds no clauses of its own (its
    // clauses are relayed from the base targets), so page reset must skip it.
    entries[summaryContextEntry(id)] = { type: 'external', reset: false };
  }
  return entries;
}

export const topologyConfig: TopologyConfig = {
  [FILTERS_ENTRY]: {
    type: 'filter-set',
    label: 'Filters',
    targets: filterSetTargets(),
    // The FilterSet subquery context is the `page` crossfilter composite: the
    // set reads its `_resolved` clauses (own-source exclusion is by source
    // identity, not the cross flag). Supplied external + wired post-construction.
    context: PAGE_ENTRY,
  },
  [SPOTLIGHT_ENTRY]: {
    type: 'single',
    label: 'Domain Spotlight',
    // Opaque passthrough surfaced on the annotated active-clause store; the
    // foreign-chip recipe reads `meta.column` to label the clause.
    meta: { column: 'domain' },
  },
  [VOLUME_BRUSH_ENTRY]: {
    // `single` so each drag replaces the brush's last interval rather than
    // accumulating one clause per drag.
    type: 'single',
    label: 'Search Volume',
    // Read by the foreign-chip recipe to label the clause (like spotlight).
    meta: { column: VOLUME_BRUSH_COLUMN },
  },
  // The crossfilter read-contexts (escape hatch — see the module doc). Declared
  // so the config is a complete namespace document; empty instances are supplied
  // in `topologyOptions.selections` and wired by `wirePageContexts`.
  // `reset: false`: derived, holds no own clauses.
  [PAGE_ENTRY]: { type: 'external', reset: false },
  [VOLUME_BRUSH_CONTEXT_ENTRY]: { type: 'external', reset: false },
  ...externalSummaryContexts(),
};

/**
 * The code-only options bag, keyed by the config's entry names: the FilterSet's
 * custom kinds and URL persister. Hoisted for the same stable-identity reason as
 * {@link topologyConfig}.
 */
function externalCompositeInstances(): Record<string, Selection> {
  const selections: Record<string, Selection> = {
    [PAGE_ENTRY]: Selection.crossfilter(),
    [VOLUME_BRUSH_CONTEXT_ENTRY]: Selection.crossfilter(),
  };
  for (const id of SUMMARY_IDS) {
    selections[summaryContextEntry(id)] = Selection.crossfilter();
  }
  return selections;
}

export const topologyOptions: TopologyOptions = {
  // Empty crossfilter composites for every `external` read-context, wired to the
  // topology's resolved targets by `wirePageContexts` right after construction.
  selections: externalCompositeInstances(),
  filterSets: {
    [FILTERS_ENTRY]: {
      kinds: {
        'metric-threshold': metricThresholdKind,
        'min-domains': minDomainsKind,
      },
      // Consumer-owned URL persistence: every spec round-trips through
      // `location.search` (one `f.` param each), so any filtered view is a
      // shareable link. `useTopology` constructs the topology during the first
      // render, synchronously before any query, so this hydrates with zero flash.
      persist: urlPersister,
    },
  },
};

// ── Wiring the external crossfilter read-contexts (escape hatch) ─────────────

/**
 * The crossfilter composites widgets read as `filterBy`, resolved from a
 * constructed topology. `page` is the everything-composite (also the FilterSet
 * context); each `summaryFilterBy[card]` is the page minus that card's own
 * membership overlay.
 */
export interface PageContexts {
  /** Everything on the page: WHERE + every card's membership + spotlight. */
  page: Selection;
  /** Per-card context: the page minus that card's own membership overlay. */
  summaryFilterBy: Record<SummaryTableId, Selection>;
  /** The phrase table's sparklines see exactly what the phrase table sees. */
  sparklineContext: Selection;
  /** The volume brush's own read-context: the page minus its own clause. */
  volumeBrushFilterBy: Selection;
}

/** Register `derived` to relay `source`'s clauses, seeding current clauses. */
function includeInto(source: Selection, derived: Selection): void {
  source._relay.add(derived);
  for (const clause of source.clauses) {
    derived.update(clause);
  }
}

const WIRED = new WeakSet<Topology>();
const CONTEXTS_CACHE = new WeakMap<Topology, PageContexts>();

/**
 * Wire the topology's `external` crossfilter composites to its resolved
 * FilterSet targets and foreign `spotlight` source, and return them as
 * {@link PageContexts}. Idempotent per topology instance: the relay wiring runs
 * once (a second call returns the cached contexts), so it is safe to call during
 * render (it must run synchronously, before the first query paints, so the
 * FilterSet's `context` reflects hydrated clauses with zero flash).
 */
export function wirePageContexts(topology: Topology): PageContexts {
  const cached = CONTEXTS_CACHE.get(topology);
  if (cached !== undefined) {
    return cached;
  }

  const where = topology.resolve(`${FILTERS_ENTRY}.where`);
  const spotlight = topology.resolve(SPOTLIGHT_ENTRY);
  const volumeBrush = topology.resolve(VOLUME_BRUSH_ENTRY);
  const members = perSummary((id) =>
    topology.resolve(`${FILTERS_ENTRY}.${membersTarget(id)}`),
  );

  const page = topology.resolve(PAGE_ENTRY);
  const volumeBrushFilterBy = topology.resolve(VOLUME_BRUSH_CONTEXT_ENTRY);
  const summaryFilterBy = perSummary((id) =>
    topology.resolve(summaryContextEntry(id)),
  );

  if (!WIRED.has(topology)) {
    WIRED.add(topology);
    includeInto(where, page);
    includeInto(spotlight, page);
    includeInto(volumeBrush, page);
    for (const id of SUMMARY_IDS) {
      includeInto(members[id], page);
    }
    // The volume-brush context relays every source page sees except the volume
    // brush itself, so the brushed histogram is never narrowed by its own brush.
    includeInto(where, volumeBrushFilterBy);
    includeInto(spotlight, volumeBrushFilterBy);
    for (const id of SUMMARY_IDS) {
      includeInto(members[id], volumeBrushFilterBy);
    }
    for (const self of SUMMARY_IDS) {
      const context = summaryFilterBy[self];
      includeInto(where, context);
      includeInto(spotlight, context);
      includeInto(volumeBrush, context);
      for (const id of SUMMARY_IDS) {
        if (id !== self) {
          includeInto(members[id], context);
        }
      }
    }
  }

  const contexts: PageContexts = {
    page,
    summaryFilterBy,
    sparklineContext: summaryFilterBy.phrase,
    volumeBrushFilterBy,
  };
  CONTEXTS_CACHE.set(topology, contexts);
  return contexts;
}
