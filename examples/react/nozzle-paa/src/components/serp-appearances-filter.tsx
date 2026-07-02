/**
 * SERP Appearances widget filter for the PAA Questions summary table.
 *
 * One logical filter producing two predicates from a single
 * (operator, value) input, gated by an explicit "apply" checkbox:
 *
 * 1. HAVING `count(*) >/< N` — published into `$serpHaving` and routed to
 *    the question table's own grouped query via `havingBy`.
 * 2. Membership subquery
 *    `related_phrase.phrase IN (SELECT … FROM nozzle_paa
 *      WHERE <question context> GROUP BY 1 HAVING count(*) >/< N)`
 *    — published into `$serpMembers`, which every sibling context includes.
 *
 * The subquery embeds the question table's own filter context so siblings
 * match exactly what the question widget displays; it rebuilds whenever that
 * context changes, and `updateClauseIfChanged` suppresses republishing when
 * the predicate is unchanged so the rebuild converges.
 */
import { useCallback, useEffect, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import {
  buildSubqueryPredicate,
  createClearClause,
  createSubqueryClause,
  createValueClause,
  updateClauseIfChanged,
} from '@nozzleio/react-mosaic';
import {
  $serpHaving,
  $serpMembers,
  summaryContexts,
  tableName,
} from '../page-context';
import type { ExprNode } from '@uwdata/mosaic-sql';

const QUESTION_COLUMN = 'related_phrase.phrase';

// Stable clause identities (module scope: survive remounts/enlarge swaps).
const SERP_HAVING_SOURCE = { id: 'paa-serp-having' };
const SERP_MEMBERS_SOURCE = {
  id: 'paa-serp-members',
  column: 'serp_appearances',
};

export type SerpComparison = 'gt' | 'lt';

export interface SerpAppearancesFilterState {
  applied: boolean;
  setApplied: (next: boolean) => void;
  comparison: SerpComparison;
  setComparison: (next: SerpComparison) => void;
  value: number | null;
  setValue: (next: number | null) => void;
}

function questionExpr() {
  return mSql.sql`"related_phrase"."phrase"`;
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

export function useSerpAppearancesFilter(options: {
  enabled: boolean;
}): SerpAppearancesFilterState {
  const { enabled } = options;
  const [applied, setApplied] = useState(false);
  const [comparison, setComparison] = useState<SerpComparison>('gt');
  const [value, setValue] = useState<number | null>(null);

  const isActive =
    applied && value !== null && Number.isFinite(value) && value >= 0;

  const publish = useCallback(() => {
    if (!isActive) {
      updateClauseIfChanged($serpHaving, createClearClause(SERP_HAVING_SOURCE));
      updateClauseIfChanged(
        $serpMembers,
        createClearClause(SERP_MEMBERS_SOURCE),
      );
      return;
    }

    const compare = comparison === 'lt' ? mSql.lt : mSql.gt;
    const label = `${comparison === 'lt' ? '<' : '>'} ${value}`;

    // 1. HAVING clause for the question table's own grouped query.
    updateClauseIfChanged(
      $serpHaving,
      createValueClause({
        source: SERP_HAVING_SOURCE,
        value: label,
        predicate: compare(mSql.count(), mSql.literal(value)),
      }),
    );

    // 2. Membership subquery for the sibling widgets, scoped to the same
    //    context the question table sees.
    const subquery = mSql.Query.select({ question: questionExpr() })
      .from(tableName)
      .groupby(questionExpr())
      .having(compare(mSql.count(), mSql.literal(value)));

    const contextPredicate = normalizeContextPredicate(
      summaryContexts.question.predicate(null),
    );
    if (contextPredicate) {
      subquery.where(contextPredicate);
    }

    updateClauseIfChanged(
      $serpMembers,
      createSubqueryClause({
        source: SERP_MEMBERS_SOURCE,
        value: label,
        predicate: buildSubqueryPredicate({
          column: QUESTION_COLUMN,
          query: subquery,
        }),
      }),
    );
  }, [isActive, value, comparison]);

  // Publish on input changes.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    publish();
  }, [enabled, publish]);

  // Rebuild the membership subquery when the question context changes.
  useEffect(() => {
    if (!enabled || !isActive) {
      return;
    }
    const context = summaryContexts.question;
    const listener = () => {
      publish();
    };
    context.addEventListener('value', listener);
    return () => {
      context.removeEventListener('value', listener);
    };
  }, [enabled, isActive, publish]);

  // External clears (global reset, chip removal) un-apply the filter so the
  // checkbox stays in sync and the HAVING clause is dropped too.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const listener = () => {
      // Inside a value listener the emitted clause list is current.
      const stillPublished = $serpMembers.clauses.some(
        (clause) => clause.source === SERP_MEMBERS_SOURCE,
      );
      if (!stillPublished) {
        setApplied(false);
      }
    };
    $serpMembers.addEventListener('value', listener);
    return () => {
      $serpMembers.removeEventListener('value', listener);
    };
  }, [isActive]);

  return { applied, setApplied, comparison, setComparison, value, setValue };
}

export function SerpAppearancesControls(props: {
  state: SerpAppearancesFilterState;
}) {
  const { state } = props;
  return (
    <div
      data-testid="serp-appearances-filter"
      className="flex items-center gap-2 text-xs text-slate-600"
    >
      <label className="flex items-center gap-1 font-semibold tracking-wide text-slate-500 uppercase">
        <input
          data-testid="serp-appearances-apply"
          type="checkbox"
          className="size-3.5 cursor-pointer"
          checked={state.applied}
          onChange={(event) => state.setApplied(event.target.checked)}
        />
        SERP Appears
      </label>
      <select
        data-testid="serp-appearances-op"
        aria-label="SERP appearances comparison"
        className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
        value={state.comparison}
        onChange={(event) =>
          state.setComparison(event.target.value as SerpComparison)
        }
      >
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
      </select>
      <input
        data-testid="serp-appearances-value"
        aria-label="SERP appearances threshold"
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
