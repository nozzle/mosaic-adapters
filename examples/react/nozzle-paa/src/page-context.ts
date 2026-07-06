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
 * ## The crossfilter read-contexts are declared `compose` entries
 *
 * The KPI/detail/facet/summary widgets read a set of *composite* contexts —
 * `page` (WHERE + every card's membership overlay + spotlight + volume brush),
 * `volumeBrushFilterBy` (the page minus its own brush clause), and one
 * `summaryFilterBy:<card>` per card (the page minus that card's own membership).
 * Each is a declared `{ type: 'compose', include: [...], as: 'crossfilter' }`
 * entry: the `include` list composes exactly the base selections that context
 * reads, and `as: 'crossfilter'` supplies the per-client clause exclusion the
 * facet/summary controls rely on (the facet self-exclusion and summary
 * self-exclusion, wired through `filterSet.set(spec, { clients })` and row-select
 * publishing). An `intersect` composite would silently disable that exclusion
 * (proven: `intersect.predicate(ownClient)` still returns the client's own
 * predicate, `crossfilter.predicate(ownClient)` returns `undefined`).
 *
 * The structural minus-self include lists are load-bearing peer exclusion:
 * `summaryFilterBy:<card>` omits that card's own `members:<card>` target, and
 * `volumeBrushFilterBy` omits the `volumeBrush` source, so each read-context is
 * never narrowed by its own clause. `page` doubles as the FilterSet's subquery
 * `context` — a `compose` that includes the set's own targets, made legal by
 * two-phase compose construction (the construction cycle is excluded from cycle
 * validation).
 */
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
import type { Selection } from '@uwdata/mosaic-core';

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

/** The page-wide crossfilter composite entry name. */
export const PAGE_ENTRY = 'page';

/** The volume-brush read-context entry name: the page minus its own clause. */
export const VOLUME_BRUSH_CONTEXT_ENTRY = 'volumeBrushFilterBy';

/** The per-card summary read-context entry name. */
export function summaryContextEntry(id: SummaryTableId): string {
  return `summaryFilterBy:${id}`;
}

/** The FilterSet target ref a card's membership subquery resolves through. */
function membersRef(id: SummaryTableId): string {
  return `${FILTERS_ENTRY}.${membersTarget(id)}`;
}

/** The `where` target ref on the page FilterSet. */
const WHERE_REF = `${FILTERS_ENTRY}.where`;

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
 * The per-card summary read-contexts, as declared `compose` entries. Each
 * `summaryFilterBy:<card>` composes WHERE + spotlight + volume brush + every
 * card's membership overlay EXCEPT its own — the structural peer-exclusion that
 * keeps a summary card unfiltered by its own selection. `as: 'crossfilter'`
 * supplies the per-client self-exclusion the card's row-select publishing
 * relies on. Composes are derived, so page reset auto-skips them.
 */
function summaryComposeContexts(): TopologyConfig {
  const entries: TopologyConfig = {};
  for (const self of SUMMARY_IDS) {
    const include = [
      WHERE_REF,
      SPOTLIGHT_ENTRY,
      VOLUME_BRUSH_ENTRY,
      ...SUMMARY_IDS.filter((id) => id !== self).map(membersRef),
    ];
    entries[summaryContextEntry(self)] = {
      type: 'compose',
      include,
      as: 'crossfilter',
    };
  }
  return entries;
}

export const topologyConfig: TopologyConfig = {
  [FILTERS_ENTRY]: {
    type: 'filter-set',
    label: 'Filters',
    targets: filterSetTargets(),
    // The FilterSet subquery context is the `page` crossfilter compose: the
    // set reads its `_resolved` clauses (own-source exclusion is by source
    // identity, not the cross flag). A compose that includes the set's own
    // targets is legal via two-phase construction (the construction cycle is
    // excluded from cycle validation).
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
  // The crossfilter read-contexts, declared as `compose` entries (see module
  // doc). `page` is the everything-composite (also the FilterSet context);
  // `volumeBrushFilterBy` is the page minus its own brush; each
  // `summaryFilterBy:<card>` is the page minus that card's own membership.
  // Composes are derived, so page reset auto-skips them.
  [PAGE_ENTRY]: {
    type: 'compose',
    as: 'crossfilter',
    include: [
      WHERE_REF,
      SPOTLIGHT_ENTRY,
      VOLUME_BRUSH_ENTRY,
      ...SUMMARY_IDS.map(membersRef),
    ],
  },
  [VOLUME_BRUSH_CONTEXT_ENTRY]: {
    type: 'compose',
    as: 'crossfilter',
    // Everything page sees EXCEPT the volume brush, so the brushed histogram is
    // never narrowed by its own brush.
    include: [WHERE_REF, SPOTLIGHT_ENTRY, ...SUMMARY_IDS.map(membersRef)],
  },
  ...summaryComposeContexts(),
};

/**
 * The code-only options bag, keyed by the config's entry names: the FilterSet's
 * custom kinds and URL persister. Hoisted for the same stable-identity reason as
 * {@link topologyConfig}.
 */
export const topologyOptions: TopologyOptions = {
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

// ── Resolving the declared crossfilter read-contexts ─────────────────────────

/**
 * The crossfilter compose contexts widgets read as `filterBy`, resolved from a
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

/**
 * Resolve the declared `compose` read-contexts from a constructed topology.
 * They are wired and seeded by `createTopology` itself (two-phase compose
 * construction), so this is a pure lookup — safe to call during render.
 */
export function resolvePageContexts(topology: Topology): PageContexts {
  const summaryFilterBy = perSummary((id) =>
    topology.resolve(summaryContextEntry(id)),
  );
  return {
    page: topology.resolve(PAGE_ENTRY),
    summaryFilterBy,
    sparklineContext: summaryFilterBy.phrase,
    volumeBrushFilterBy: topology.resolve(VOLUME_BRUSH_CONTEXT_ENTRY),
  };
}
