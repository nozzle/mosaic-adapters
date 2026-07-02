/**
 * The page's Selection topology, built once at module scope from native
 * Mosaic constructors — `Selection.intersect({ include })` composes contexts
 * by relaying clauses from upstream selections, so the legacy hand-rolled
 * peer-minus-self cascade becomes a set of static include lists.
 *
 * Peer-minus-self is structural here (each context simply omits its owner's
 * output selection) rather than clients-set based: clause `clients` sets are
 * bound to client *instances*, and the summary tables remount on
 * enlarge/collapse, which would leave stale exclusion sets behind. Static
 * contexts also keep each summary table out of its own metric-threshold
 * membership overlay by construction (§2 of the spec: a table applies the
 * same restriction through its own HAVING instead).
 */
import { Selection } from '@uwdata/mosaic-core';
import { createFilterRegistry } from '@nozzleio/react-mosaic';
import type { ClauseSource } from '@uwdata/mosaic-core';

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

// ── Atomic selections ────────────────────────────────────────────────────────

/** Top-bar input filters (facets, text, date range, min-domains subquery). */
export const $inputs = {
  domain: Selection.intersect(),
  phrase: Selection.intersect(),
  keywordGroup: Selection.intersect(),
  desc: Selection.intersect(),
  date: Selection.intersect(),
  device: Selection.intersect(),
  question: Selection.intersect(),
  questionDomains: Selection.intersect(),
};

/** Per-summary-table row-selection outputs, consumed by every sibling. */
export const $summarySelections: Record<SummaryTableId, Selection> = perSummary(
  () => Selection.intersect(),
);

/** Detail-table column filters (the TanStack filter bridge publishes here). */
export const $detail = Selection.intersect();

/**
 * Every summary card's metric-threshold filter: one logical
 * (operator, value) input, two predicates. `$metricHaving[id]` routes
 * `<metric agg> >/< N` into that card's own grouped query via `havingBy`;
 * `$metricMembers[id]` carries the membership subquery
 * (`<groupKey> IN (SELECT <groupKey> … GROUP BY 1 HAVING <agg cmp N>)`)
 * that narrows every *other* widget to the matching group subset.
 */
export const $metricHaving: Record<SummaryTableId, Selection> = perSummary(() =>
  Selection.intersect(),
);
export const $metricMembers: Record<SummaryTableId, Selection> = perSummary(
  () => Selection.intersect(),
);

// ── Composed contexts ────────────────────────────────────────────────────────

const allInputs = Object.values($inputs);
const allSummaries = Object.values($summarySelections);
const allMembers = Object.values($metricMembers);

function summariesExcept(self: SummaryTableId): Array<Selection> {
  return SUMMARY_IDS.filter((id) => id !== self).map(
    (id) => $summarySelections[id],
  );
}

function membersExcept(self: SummaryTableId): Array<Selection> {
  return SUMMARY_IDS.filter((id) => id !== self).map(
    (id) => $metricMembers[id],
  );
}

/**
 * Facet-input contexts: every *other* input + the outside world (detail
 * filters, summary selections, membership overlays), never the facet's own
 * selection — options cascade without the ghost-option bug.
 */
function facetContext(self: Selection): Selection {
  return Selection.intersect({
    include: [
      ...allInputs.filter((input) => input !== self),
      $detail,
      ...allSummaries,
      ...allMembers,
    ],
  });
}

export const facetContexts = {
  domain: facetContext($inputs.domain),
  keywordGroup: facetContext($inputs.keywordGroup),
  device: facetContext($inputs.device),
};

/**
 * Summary-table contexts: all inputs + detail + every *other* summary
 * selection + every *other* card's membership overlay. A card's own overlay
 * is deliberately excluded — it applies the equivalent restriction via
 * `havingBy` on its own grouped query, so the membership predicate would be
 * redundant there.
 */
export const summaryContexts: Record<SummaryTableId, Selection> = perSummary(
  (id) =>
    Selection.intersect({
      include: [
        ...allInputs,
        $detail,
        ...summariesExcept(id),
        ...membersExcept(id),
      ],
    }),
);

/**
 * The phrase table's sparklines see exactly what the phrase table sees —
 * everything except the phrase table's own row selection and overlay.
 */
export const sparklineContext = summaryContexts.phrase;

/**
 * Detail-table context. Unlike the summaries, the detail table IS filtered
 * by its own column filters ($detail is in its own context) — bridge clauses
 * deliberately have no self-exclusion.
 */
export const detailContext = Selection.intersect({
  include: [...allInputs, $detail, ...allSummaries, ...allMembers],
});

/** KPI context: filtered by everything on the page (except HAVING routing). */
export const kpiContext = Selection.intersect({
  include: [...allInputs, $detail, ...allSummaries, ...allMembers],
});

// ── Row-selection clause identities ──────────────────────────────────────────

/**
 * Stable publish sources for the summary tables' `publish.select`. Module
 * scope, so the published clause identity survives the enlarge/collapse
 * remount — the rows client retains the clause on destroy and the next
 * instance replaces it (see RowsPublishTarget.source).
 */
export const summarySelectSources: Record<SummaryTableId, ClauseSource> =
  perSummary(() => ({}));

// ── The filter registry (chip bar + global reset) ───────────────────────────

export const filterRegistry = createFilterRegistry();

filterRegistry.registerGroup({
  id: 'global',
  label: 'Global Controls',
  priority: 1,
});
filterRegistry.registerGroup({
  id: 'summary',
  label: 'Summary Selections',
  priority: 2,
});
filterRegistry.registerGroup({
  id: 'detail',
  label: 'Detail Filters',
  priority: 3,
});

filterRegistry.register($inputs.domain, { group: 'global', label: 'Domain' });
filterRegistry.register($inputs.phrase, { group: 'global', label: 'Keyword' });
filterRegistry.register($inputs.keywordGroup, {
  group: 'global',
  label: 'Keyword Group',
});
filterRegistry.register($inputs.desc, {
  group: 'global',
  label: 'Answer Text',
});
filterRegistry.register($inputs.date, {
  group: 'global',
  label: 'Date Range',
});
filterRegistry.register($inputs.device, { group: 'global', label: 'Device' });
filterRegistry.register($inputs.question, {
  group: 'global',
  label: 'Question',
});
filterRegistry.register($inputs.questionDomains, {
  group: 'global',
  label: 'Min Domains',
  formatValue: (value) => `≥ ${String(value)}`,
});

filterRegistry.register($summarySelections.phrase, {
  group: 'summary',
  label: 'Selected Keyword',
  explodeValues: true,
  fields: ['phrase'],
});
filterRegistry.register($summarySelections.question, {
  group: 'summary',
  label: 'Selected Question',
  explodeValues: true,
  fields: ['related_phrase.phrase'],
});
filterRegistry.register($summarySelections.domain, {
  group: 'summary',
  label: 'Selected Domain',
  explodeValues: true,
  fields: ['domain'],
});
filterRegistry.register($summarySelections.url, {
  group: 'summary',
  label: 'Selected URL',
  explodeValues: true,
  fields: ['url'],
});

// A membership chip's X clears the members clause; the owning card's
// metric-threshold hook notices and un-applies itself, dropping the HAVING
// clause too. The HAVING selections render no chips of their own but
// participate in global reset.
export const metricChipLabels: Record<SummaryTableId, string> = {
  phrase: 'Search Vol',
  question: 'SERP Appears',
  domain: 'Domain Answers',
  url: 'URL Answers',
};

for (const id of SUMMARY_IDS) {
  filterRegistry.register($metricMembers[id], {
    group: 'summary',
    label: metricChipLabels[id],
  });
  filterRegistry.registerForReset($metricHaving[id]);
}

filterRegistry.register($detail, {
  group: 'detail',
  labelMap: {
    domain: 'Domain',
    paa_question: 'PAA Question',
    title: 'Answer Title',
    description: 'Answer Description',
  },
});
