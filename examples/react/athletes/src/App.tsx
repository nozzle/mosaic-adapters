import { useEffect, useState } from 'react';
import { initAthletesTable } from './mosaic-setup';
import { AthletesTable } from './components/athletes-table';
import { KpiCards } from './components/kpi-cards';
import { ScatterPlot } from './components/scatter-plot';

/**
 * The executable north star (issue #131, round 3 Part A) scoped to Phases
 * 1–3: KPI cards (values client + $metric Param), a native vgplot
 * scatterplot, and a user-owned TanStack table in fully manual mode — all
 * cross-filtering through one Selection.crossfilter() ($page).
 */
function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    initAthletesTable()
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <Shell>
        <p className="text-sm text-red-600" data-testid="load-error">
          Failed to load the athletes dataset: {error.message}
        </p>
      </Shell>
    );
  }

  if (!ready) {
    return (
      <Shell>
        <p className="text-sm italic text-slate-500" data-testid="loading">
          Loading DuckDB and the athletes dataset…
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <KpiCards />
      <div className="flex flex-wrap gap-6">
        <ScatterPlot />
        <div className="flex flex-col gap-3">
          {/* TODO(#163): sport facet select — options + cascading counts from
              the facet client, publishing a point clause into $page. */}
          <PhaseFiveSeam label="Sport facet select" />
          {/* TODO(#163): brushable weight histogram — bins from the histogram
              client, custom-rendered, publishing an interval clause into
              $page. */}
          <PhaseFiveSeam label="Brushable weight histogram" />
        </div>
      </div>
      <AthletesTable />
    </Shell>
  );
}

function Shell(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900">
            Athletes dashboard
          </h1>
          <p className="text-sm text-slate-500">
            Mosaic data clients + native vgplot on one crossfilter Selection.
          </p>
        </header>
        {props.children}
      </div>
    </div>
  );
}

function PhaseFiveSeam(props: { label: string }) {
  return (
    <div className="flex h-full min-h-16 w-64 items-center justify-center rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
      {props.label} — arrives with its data client in Phase 5 (#163)
    </div>
  );
}

export default App;
