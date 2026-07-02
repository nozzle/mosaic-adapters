import { useState } from 'react';
import { Query, column, count, sum } from '@uwdata/mosaic-sql';
import { useMosaicValues } from '@nozzleio/react-mosaic';
import { $metric, $page, tableName } from '../page-context';
import type { MedalMetric } from '../page-context';

type KpiValues = {
  athletes: number | bigint;
  medals: number | bigint | null;
};

const metricLabels: Record<MedalMetric, string> = {
  gold: 'Gold medals',
  silver: 'Silver medals',
  bronze: 'Bronze medals',
};

/**
 * One values client serves every KPI card in a single round trip: a
 * single-row aggregate query whose columns become a typed record. It is
 * cross-filtered by $page (brush + column filters) and re-queries when
 * $metric changes.
 */
export function KpiCards() {
  const [metric, setMetric] = useState<MedalMetric>($metric.value ?? 'gold');

  const kpis = useMosaicValues<KpiValues>({
    query: ({ where }) =>
      Query.from(tableName)
        .select({
          athletes: count(),
          medals: sum(column($metric.value ?? 'gold')),
        })
        .where(where),
    filterBy: $page,
    params: { metric: $metric },
  });

  const pending = kpis.status === 'pending';

  return (
    <div className="flex flex-wrap items-end gap-4">
      <KpiCard
        label="Athletes"
        value={kpis.values?.athletes}
        pending={pending}
        testId="kpi-athletes"
      />
      <KpiCard
        label={metricLabels[metric]}
        value={kpis.values?.medals}
        pending={pending}
        testId="kpi-medals"
      />
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        KPI metric
        <select
          className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
          data-testid="metric-select"
          value={metric}
          onChange={(event) => {
            const next = event.target.value as MedalMetric;
            setMetric(next);
            $metric.update(next);
          }}
        >
          <option value="gold">Gold</option>
          <option value="silver">Silver</option>
          <option value="bronze">Bronze</option>
        </select>
      </label>
    </div>
  );
}

function KpiCard(props: {
  label: string;
  value: number | bigint | null | undefined;
  pending: boolean;
  testId: string;
}) {
  return (
    <div className="min-w-36 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {props.label}
      </div>
      <div
        className={`text-2xl font-semibold tabular-nums ${
          props.pending ? 'text-slate-400' : 'text-slate-900'
        }`}
        data-testid={props.testId}
      >
        {formatCount(props.value)}
      </div>
    </div>
  );
}

function formatCount(value: number | bigint | null | undefined): string {
  if (value == null) {
    return '—';
  }
  return Number(value).toLocaleString('en-US');
}
