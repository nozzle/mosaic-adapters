/**
 * The page's Selection topology and its single {@link FilterSet}.
 *
 * Every dashboard filter — top-bar text/date/min-domains, facet picks, summary
 * row selections, per-card metric thresholds, detail column filters — is a
 * {@link FilterSpec} on `filterSet`. The set owns clause publication, targets,
 * self-exclusion `clients`, chips, and global reset; the components only read
 * its store and call its mutators.
 *
 * Topology (native Mosaic constructors, module scope):
 *
 * - `$where = Selection.crossfilter()` — the shared WHERE target. Text, date,
 *   min-domains, facet picks, summary row selections, and detail filters all
 *   land here. Per-widget self-exclusion is clause-`clients` based (publish.into
 *   wires it), governed by the OUTER selection's cross flag when composed.
 * - `$having[card]` × 4 — a card's own metric HAVING (`<agg> >/< N`), wired to
 *   its grouped rows query via `havingBy`.
 * - `$members[card]` × 4 — a card's metric membership subquery
 *   (`<groupKey> IN (SELECT … HAVING <agg cmp N>)`), narrowing every sibling.
 * - `$page = Selection.crossfilter({ include: [$where, ...all members] })` —
 *   the everything-composite; filterBy for KPIs, detail, facets, sparkline. It
 *   is also the set's `context`, so the metric kind's subquery WHERE embeds the
 *   full page predicate (own-spec-source excluded by the set).
 * - `summaryFilterBy[card] = Selection.crossfilter({ include: [$where,
 *   ...members of the OTHER three cards] })` — a summary table sees the page
 *   minus its own membership overlay (its own HAVING applies that instead).
 *
 * MUST be `Selection.crossfilter({ include })`, never `intersect`: per-client
 * clause exclusion (facet/summary self-exclusion) is governed by the outer
 * composite's cross flag, so an intersect composite would silently disable it.
 */
import { Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  buildSubqueryPredicate,
  createFilterSet,
  createStructAccess,
  subqueryFilterKind,
} from '@nozzleio/react-mosaic';
import type { FilterKind, FilterKindArgs } from '@nozzleio/react-mosaic';
import type { ExprNode } from '@uwdata/mosaic-sql';

export const tableName = 'nozzle_paa';

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

// ── Target Selections ────────────────────────────────────────────────────────

/** Shared WHERE target: text, date, min-domains, facets, summary rows, detail. */
export const $where = Selection.crossfilter();

/** Per-card metric HAVING (`<agg> >/< N`), routed via `havingBy`. */
export const $having: Record<SummaryTableId, Selection> = perSummary(() =>
  Selection.crossfilter(),
);

/** Per-card metric membership subquery, seen by every sibling. */
export const $members: Record<SummaryTableId, Selection> = perSummary(() =>
  Selection.crossfilter(),
);

// ── Composed contexts ────────────────────────────────────────────────────────

const allMembers = SUMMARY_IDS.map((id) => $members[id]);

function membersExcept(self: SummaryTableId): Array<Selection> {
  return SUMMARY_IDS.filter((id) => id !== self).map((id) => $members[id]);
}

/** Everything on the page: WHERE + every card's membership overlay. */
export const $page = Selection.crossfilter({
  include: [$where, ...allMembers],
});

/**
 * Per-summary-table filter context: the page minus this card's own membership
 * overlay (the card applies that restriction through its own HAVING instead).
 */
export const summaryFilterBy: Record<SummaryTableId, Selection> = perSummary(
  (id) =>
    Selection.crossfilter({
      include: [$where, ...membersExcept(id)],
    }),
);

/**
 * The phrase table's sparklines see exactly what the phrase table sees.
 */
export const sparklineContext = summaryFilterBy.phrase;

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
 * `metric-threshold` kind. One spec per card (`metric:<card>`) with an operator
 * (`gt`/`lt`) and a numeric value emits two clauses:
 *
 * 1. `having:<card>` — `<agg> >/< N` for the card's own grouped query.
 * 2. `members:<card>` — `<groupKey> IN (SELECT <groupKey> FROM nozzle_paa
 *    WHERE <page predicate> GROUP BY 1 HAVING <agg cmp N>)`, so every sibling
 *    narrows to the matching group subset. Reading `contextPredicate` registers
 *    the spec as context-dependent, so the set rebuilds this on page changes.
 */
export const metricThresholdKind: FilterKind = {
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
        target: `having:${cardId}`,
        clause: { value, predicate: havingPredicate },
      },
      {
        target: `members:${cardId}`,
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
 * `min-domains` — keep rows whose PAA question appears on at least N distinct
 * domains:
 *
 *   related_phrase.phrase IN (
 *     SELECT related_phrase.phrase FROM nozzle_paa
 *     GROUP BY 1 HAVING count(DISTINCT domain) >= N)
 */
export const minDomainsKind: FilterKind = {
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

// ── The page FilterSet ───────────────────────────────────────────────────────

function havingTargets(): Record<string, Selection> {
  return Object.fromEntries(
    SUMMARY_IDS.map((id) => [`having:${id}`, $having[id]]),
  );
}

function membersTargets(): Record<string, Selection> {
  return Object.fromEntries(
    SUMMARY_IDS.map((id) => [`members:${id}`, $members[id]]),
  );
}

/**
 * The single page-level filter set. Every widget publishes/reads specs here;
 * the chip bar and Clear All are `useFilterSetChips` + `filterSet.reset()`.
 */
export const filterSet = createFilterSet({
  targets: {
    where: $where,
    ...havingTargets(),
    ...membersTargets(),
  },
  kinds: {
    'metric-threshold': metricThresholdKind,
    'min-domains': minDomainsKind,
  },
  context: $page,
});
