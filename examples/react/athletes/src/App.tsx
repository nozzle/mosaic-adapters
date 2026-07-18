import { useEffect, useState } from 'react';
import { MosaicTopologyProvider, useTopology } from '@nozzleio/react-mosaic';
import { initAthletesTable } from './mosaic-setup';
import { pageTopologyConfig } from './page-context';
import { AthletesTable } from './components/athletes-table';
import { KpiCards } from './components/kpi-cards';
import { PivotView } from './components/pivot-view';
import { RollupView } from './components/rollup-view';
import { ScatterPlot } from './components/scatter-plot';
import { SportFacet } from './components/sport-facet';
import { WeightHistogram } from './components/weight-histogram';

type View = 'dashboard' | 'rollup' | 'pivot';

function currentView(): View {
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'rollup' || view === 'pivot') {
    return view;
  }
  return 'dashboard';
}

/**
 * The executable north star (issue #131, round 3 Part A): KPI cards (values
 * client + topology-declared `metric` Param), a sport facet select, a
 * brushable custom-rendered weight histogram, a native vgplot scatterplot,
 * and a user-owned TanStack
 * Table in fully manual mode with a batched sparkline column — all
 * cross-filtering through one Selection.crossfilter() ($page). The rollup
 * and pivot views (?view=rollup / ?view=pivot) show the SQL-first grouped
 * clients on the same dataset.
 */
function App() {
  const topology = useTopology(pageTopologyConfig);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const view = currentView();

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

  let content: React.ReactNode;
  if (error !== null) {
    content = (
      <Shell view={view}>
        <p className="text-sm text-red-600" data-testid="load-error">
          Failed to load the athletes dataset: {error.message}
        </p>
      </Shell>
    );
  } else if (!ready) {
    content = (
      <Shell view={view}>
        <p className="text-sm italic text-slate-500" data-testid="loading">
          Loading DuckDB and the athletes dataset…
        </p>
      </Shell>
    );
  } else if (view === 'rollup') {
    content = (
      <Shell view={view}>
        <RollupView />
      </Shell>
    );
  } else if (view === 'pivot') {
    content = (
      <Shell view={view}>
        <PivotView />
      </Shell>
    );
  } else {
    content = (
      <Shell view={view}>
        <KpiCards />
        <div className="flex flex-wrap gap-6">
          <ScatterPlot />
          <div className="flex flex-col gap-3">
            <SportFacet />
            <WeightHistogram />
          </div>
        </div>
        <AthletesTable />
      </Shell>
    );
  }

  return (
    <MosaicTopologyProvider topology={topology}>
      {content}
    </MosaicTopologyProvider>
  );
}

const viewLinks: Array<{ view: View; href: string; label: string }> = [
  { view: 'dashboard', href: '?', label: 'Dashboard' },
  { view: 'rollup', href: '?view=rollup', label: 'Rollup' },
  { view: 'pivot', href: '?view=pivot', label: 'Pivot' },
];

function Shell(props: { view: View; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Athletes dashboard
            </h1>
            <p className="text-sm text-slate-500">
              Mosaic data clients + native vgplot on one crossfilter Selection.
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            {viewLinks.map((link) => (
              <a
                key={link.view}
                href={link.href}
                data-testid={`view-${link.view}`}
                className={
                  props.view === link.view
                    ? 'font-semibold text-slate-900 underline'
                    : 'text-slate-500 hover:underline'
                }
              >
                {link.label}
              </a>
            ))}
          </nav>
        </header>
        {props.children}
      </div>
    </div>
  );
}

export default App;
