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
 * contexts also keep the question table out of the SERP membership overlay
 * by construction (§2 of the spec: it applies the same restriction through
 * its own HAVING instead).
 */
import { Selection } from '@uwdata/mosaic-core';
import { createFilterRegistry } from '@nozzleio/react-mosaic';
import type { ClauseSource } from '@uwdata/mosaic-core';

export const tableName = 'nozzle_paa';

export type SummaryTableId = 'phrase' | 'question' | 'domain' | 'url';

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
export const $summarySelections: Record<SummaryTableId, Selection> = {
  phrase: Selection.intersect(),
  question: Selection.intersect(),
  domain: Selection.intersect(),
  url: Selection.intersect(),
};

/** Detail-table column filters (the TanStack filter bridge publishes here). */
export const $detail = Selection.intersect();

/**
 * The SERP-appearances widget filter: one logical (operator, value) input,
 * two predicates. `$serpHaving` routes `count(*) >/< N` into the question
 * table's grouped query via `havingBy`; `$serpMembers` carries the
 * membership subquery that narrows every *other* widget to the matching
 * question subset.
 */
export const $serpHaving = Selection.intersect();
export const $serpMembers = Selection.intersect();

// ── Composed contexts ────────────────────────────────────────────────────────

const allInputs = Object.values($inputs);
const allSummaries = Object.values($summarySelections);

function summariesExcept(self: SummaryTableId): Array<Selection> {
  return Object.entries($summarySelections)
    .filter(([id]) => id !== self)
    .map(([, selection]) => selection);
}

/**
 * Facet-input contexts: every *other* input + the outside world (detail
 * filters, summary selections, SERP membership), never the facet's own
 * selection — options cascade without the ghost-option bug.
 */
function facetContext(self: Selection): Selection {
  return Selection.intersect({
    include: [
      ...allInputs.filter((input) => input !== self),
      $detail,
      ...allSummaries,
      $serpMembers,
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
 * selection. The phrase/domain/url tables additionally see the SERP
 * membership subquery; the question table is deliberately excluded — it
 * applies the equivalent restriction via `havingBy` on its own grouped
 * query, so the membership predicate would be redundant there.
 */
function summaryContext(
  self: SummaryTableId,
  extra: Array<Selection> = [],
): Selection {
  return Selection.intersect({
    include: [...allInputs, $detail, ...summariesExcept(self), ...extra],
  });
}

export const summaryContexts: Record<SummaryTableId, Selection> = {
  phrase: summaryContext('phrase', [$serpMembers]),
  question: summaryContext('question'),
  domain: summaryContext('domain', [$serpMembers]),
  url: summaryContext('url', [$serpMembers]),
};

/**
 * The phrase table's sparklines see exactly what the phrase table sees —
 * including everything except the phrase table's own row selection.
 */
export const sparklineContext = summaryContexts.phrase;

/**
 * Detail-table context. Unlike the summaries, the detail table IS filtered
 * by its own column filters ($detail is in its own context) — bridge clauses
 * deliberately have no self-exclusion.
 */
export const detailContext = Selection.intersect({
  include: [...allInputs, $detail, ...allSummaries, $serpMembers],
});

/** KPI context: filtered by everything on the page (except HAVING routing). */
export const kpiContext = Selection.intersect({
  include: [...allInputs, $detail, ...allSummaries, $serpMembers],
});

// ── Row-selection clause identities ──────────────────────────────────────────

/**
 * Stable publish sources for the summary tables' `publish.select`. Module
 * scope, so the published clause identity survives the enlarge/collapse
 * remount — the rows client retains the clause on destroy and the next
 * instance replaces it (see RowsPublishTarget.source).
 */
export const summarySelectSources: Record<SummaryTableId, ClauseSource> = {
  phrase: {},
  question: {},
  domain: {},
  url: {},
};

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
filterRegistry.register($inputs.date, { group: 'global', label: 'Date Range' });
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

// The membership chip's X clears the members clause; the SERP widget hook
// notices and un-applies itself, dropping the HAVING clause too. The HAVING
// selection renders no chip of its own but participates in global reset.
filterRegistry.register($serpMembers, {
  group: 'summary',
  label: 'SERP Appears',
});
filterRegistry.registerForReset($serpHaving);

filterRegistry.register($detail, {
  group: 'detail',
  labelMap: {
    domain: 'Domain',
    paa_question: 'PAA Question',
    title: 'Answer Title',
    description: 'Answer Description',
  },
});
