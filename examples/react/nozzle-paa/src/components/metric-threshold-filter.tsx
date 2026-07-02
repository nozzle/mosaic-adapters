/**
 * Metric-threshold widget filter — every summary card gets one, on its own
 * computed metric column (the legacy page had this only on the PAA Questions
 * card as the "SERP Appears" filter).
 *
 * One logical filter producing two predicates from a single
 * (operator, value) input, gated by an explicit "apply" checkbox:
 *
 * 1. HAVING `<metric agg> >/< N` — published into `$metricHaving[id]` and
 *    routed to the card's own grouped query via `havingBy`.
 * 2. Membership subquery
 *    `<groupKey> IN (SELECT <groupKey> FROM nozzle_paa
 *      WHERE <card context> GROUP BY 1 HAVING <agg cmp N>)`
 *    — published into `$metricMembers[id]`, which every sibling context
 *    includes (the owning card is excluded structurally: its own HAVING
 *    already applies the restriction).
 *
 * The subquery embeds the card's own filter context so siblings match
 * exactly what the card displays; it rebuilds whenever that context changes,
 * and `updateClauseIfChanged` suppresses republishing when the predicate is
 * unchanged so the rebuild converges.
 */
import { useCallback, useEffect, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import {
  SqlIdentifier,
  buildSubqueryPredicate,
  createClearClause,
  createStructAccess,
  createSubqueryClause,
  createValueClause,
  updateClauseIfChanged,
} from '@nozzleio/react-mosaic';
import {
  $metricHaving,
  $metricMembers,
  metricChipLabels,
  summaryContexts,
  tableName,
} from '../page-context';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { SummaryTableId } from '../page-context';

export interface MetricThresholdConfig {
  id: SummaryTableId;
  /** Group-by column (dotted paths are struct access). */
  groupBy: string;
  /** The card's metric aggregate — the HAVING left-hand side. */
  metric: { agg: 'count' } | { agg: 'max'; column: string };
}

// Stable clause identities (module scope: survive remounts/enlarge swaps).
const SOURCES: Record<
  SummaryTableId,
  { having: { id: string }; members: { id: string; column: string } }
> = {
  phrase: {
    having: { id: 'paa-metric-having-phrase' },
    members: { id: 'paa-metric-members-phrase', column: 'search_volume' },
  },
  question: {
    having: { id: 'paa-metric-having-question' },
    members: { id: 'paa-metric-members-question', column: 'serp_appearances' },
  },
  domain: {
    having: { id: 'paa-metric-having-domain' },
    members: { id: 'paa-metric-members-domain', column: 'domain_answers' },
  },
  url: {
    having: { id: 'paa-metric-having-url' },
    members: { id: 'paa-metric-members-url', column: 'url_answers' },
  },
};

export type MetricComparison = 'gt' | 'lt';

export interface MetricThresholdFilterState {
  config: MetricThresholdConfig;
  applied: boolean;
  setApplied: (next: boolean) => void;
  comparison: MetricComparison;
  setComparison: (next: MetricComparison) => void;
  value: number | null;
  setValue: (next: number | null) => void;
}

function normalizeContextPredicate(
  predicate: ReturnType<(typeof summaryContexts)['question']['predicate']>,
): ExprNode | null {
  if (!predicate) {
    return null;
  }
  if (!Array.isArray(predicate)) {
    return predicate as ExprNode;
  }
  if (predicate.length === 0) {
    return null;
  }
  if (predicate.length === 1) {
    return (predicate[0] ?? null) as ExprNode | null;
  }
  return mSql.and(...(predicate as Array<ExprNode>));
}

function metricAggExpr(config: MetricThresholdConfig) {
  if (config.metric.agg === 'count') {
    return mSql.count();
  }
  return mSql.max(config.metric.column);
}

export function useMetricThresholdFilter(options: {
  config: MetricThresholdConfig;
  enabled: boolean;
}): MetricThresholdFilterState {
  const { config, enabled } = options;
  const having = $metricHaving[config.id];
  const members = $metricMembers[config.id];
  const context = summaryContexts[config.id];
  const sources = SOURCES[config.id];

  const [applied, setApplied] = useState(false);
  const [comparison, setComparison] = useState<MetricComparison>('gt');
  const [value, setValue] = useState<number | null>(null);

  const isActive =
    applied && value !== null && Number.isFinite(value) && value >= 0;

  const publish = useCallback(() => {
    if (!isActive) {
      updateClauseIfChanged(having, createClearClause(sources.having));
      updateClauseIfChanged(members, createClearClause(sources.members));
      return;
    }

    const compare = comparison === 'lt' ? mSql.lt : mSql.gt;
    const label = `${comparison === 'lt' ? '<' : '>'} ${value}`;

    // 1. HAVING clause for the card's own grouped query.
    updateClauseIfChanged(
      having,
      createValueClause({
        source: sources.having,
        value: label,
        predicate: compare(metricAggExpr(config), mSql.literal(value)),
      }),
    );

    // 2. Membership subquery for the sibling widgets, scoped to the same
    //    context this card sees.
    const groupKey = createStructAccess(SqlIdentifier.from(config.groupBy));
    const subquery = mSql.Query.select({ member: groupKey })
      .from(tableName)
      .groupby(groupKey)
      .having(compare(metricAggExpr(config), mSql.literal(value)));

    const contextPredicate = normalizeContextPredicate(context.predicate(null));
    if (contextPredicate) {
      subquery.where(contextPredicate);
    }

    updateClauseIfChanged(
      members,
      createSubqueryClause({
        source: sources.members,
        value: label,
        predicate: buildSubqueryPredicate({
          column: config.groupBy,
          query: subquery,
        }),
      }),
    );
  }, [isActive, value, comparison, config, having, members, context, sources]);

  // Publish on input changes.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    publish();
  }, [enabled, publish]);

  // Rebuild the membership subquery when the card's context changes.
  useEffect(() => {
    if (!enabled || !isActive) {
      return;
    }
    const listener = () => {
      publish();
    };
    context.addEventListener('value', listener);
    return () => {
      context.removeEventListener('value', listener);
    };
  }, [context, enabled, isActive, publish]);

  // External clears (global reset, chip removal) un-apply the filter so the
  // checkbox stays in sync and the HAVING clause is dropped too.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const listener = () => {
      // Inside a value listener the emitted clause list is current.
      const stillPublished = members.clauses.some(
        (clause) => clause.source === sources.members,
      );
      if (!stillPublished) {
        setApplied(false);
      }
    };
    members.addEventListener('value', listener);
    return () => {
      members.removeEventListener('value', listener);
    };
  }, [isActive, members, sources]);

  return {
    config,
    applied,
    setApplied,
    comparison,
    setComparison,
    value,
    setValue,
  };
}

export function MetricThresholdControls(props: {
  state: MetricThresholdFilterState;
}) {
  const { state } = props;
  const { id } = state.config;
  return (
    <div
      data-testid={`metric-filter-${id}`}
      className="flex items-center gap-2 text-xs text-slate-600"
    >
      <label className="flex items-center gap-1 font-semibold tracking-wide text-slate-500 uppercase">
        <input
          data-testid={`metric-filter-${id}-apply`}
          type="checkbox"
          className="size-3.5 cursor-pointer"
          checked={state.applied}
          onChange={(event) => state.setApplied(event.target.checked)}
        />
        {metricChipLabels[id]}
      </label>
      <select
        data-testid={`metric-filter-${id}-op`}
        aria-label={`${metricChipLabels[id]} comparison`}
        className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
        value={state.comparison}
        onChange={(event) =>
          state.setComparison(event.target.value as MetricComparison)
        }
      >
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
      </select>
      <input
        data-testid={`metric-filter-${id}-value`}
        aria-label={`${metricChipLabels[id]} threshold`}
        type="number"
        min={0}
        placeholder="N"
        className="h-7 w-16 rounded border border-slate-200 bg-white px-2 text-xs"
        value={state.value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          state.setValue(raw === '' ? null : Number(raw));
        }}
      />
    </div>
  );
}
