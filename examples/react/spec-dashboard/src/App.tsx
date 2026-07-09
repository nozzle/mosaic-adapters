/**
 * The spec-driven dashboard shell. Fetches the active spec YAML, compiles it
 * (YAML → zod → topology `validNames` → cross-reference validation), owns the
 * coordinator + data load, builds the topology via `useTopology`, and renders the
 * layout grid of registry widgets alongside the filter builder, active-filter
 * bar, and spec editor panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MosaicProvider,
  MosaicTopologyProvider,
  useMosaicTopology,
  useTopology,
} from '@nozzleio/react-mosaic';
import { ConnectorProvider, useConnector } from './connector';
import { useDataLoad } from './data-loader';
import {
  compileSpec,
  fetchManifest,
  fetchSpecText,
  resolveSpecEntry,
} from './spec/compile';
import { buildSelfRoutingKindNames } from './spec/kinds';
import {
  FILTERS_ENTRY,
  getPrimaryFilterSet,
  resolveSelection,
} from './spec/topology';
import { widgetRegistry } from './widgets/registry';
import { ActiveFilterBar } from './chrome/active-filter-bar';
import { FilterBuilder } from './chrome/filter-builder';
import { SpecEditorPanel, SpecEditorToggle } from './chrome/spec-editor';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { CompiledSpec, SpecManifest } from './spec/compile';
import type { DashboardSpec, LayoutSpec, WidgetSpec } from './spec/schema';
import type { WidgetContext } from './widgets/registry';

// The URL search param that selects the active spec id (plain URLSearchParams —
// there is no router). Absent/unknown → the manifest `default`.
const SPEC_PARAM = 'spec';

// Generic, domain-blind header fallback. The spec supplies the real title
// (`title` in the spec YAML); this renders only when it is absent, so no domain
// vocabulary lives in src/.
const DEFAULT_TITLE = 'Spec-driven Dashboard';

/** The `?spec=` value from the current URL, or null when absent. */
function readSpecParam(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return new URLSearchParams(window.location.search).get(SPEC_PARAM);
}

/** Persist the active spec id to `?spec=<id>` without a navigation. */
function writeSpecParam(id: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set(SPEC_PARAM, id);
  window.history.replaceState(null, '', url);
}

// Tailwind cannot generate fully-dynamic class names, so map the spec's numeric
// column count / per-widget span to static class strings.
const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-5',
};

const SPAN_CLASS: Record<number, string> = {
  1: '',
  2: 'xl:col-span-2',
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  5: 'xl:col-span-5',
};

function App() {
  return (
    <ConnectorProvider>
      <Bootstrap />
    </ConnectorProvider>
  );
}

type SpecState =
  | { status: 'loading' }
  | { status: 'fetch-error'; message: string }
  | { status: 'invalid'; errors: Array<string> }
  | {
      status: 'ready';
      compiled: CompiledSpec;
      /** Bumped on every successful editor Apply → remounts the dashboard. */
      revision: number;
      /** The currently-applied spec text (seeds the editor draft). */
      text: string;
      /** The originally-fetched spec text (the editor's Reset target). */
      originalText: string;
    };

/**
 * Boot the dashboard: fetch the spec manifest, resolve the active spec id from
 * the `?spec=` URL param (falling back to the manifest `default`), fetch + compile
 * that spec's YAML, then hand a valid {@link CompiledSpec} to the connection-keyed
 * dashboard. An invalid INITIAL spec surfaces its errors without a dashboard; once
 * a dashboard is running, the editor's Apply flow keeps the last-good one alive on
 * a compile failure (the errors render in the editor panel, not here).
 *
 * The quick-load selector (rendered in the chrome) switches specs: it writes
 * `?spec=<id>`, fetches that spec fresh, and bumps the revision to remount —
 * intentionally discarding any unsaved editor edits (a SWITCH, not an Apply).
 */
function Bootstrap() {
  const { coordinator, connectionId } = useConnector();
  const [manifest, setManifest] = useState<SpecManifest | null>(null);
  const [activeSpecId, setActiveSpecId] = useState<string | null>(null);
  const [state, setState] = useState<SpecState>({ status: 'loading' });
  // Guards against out-of-order fetches when specs are switched rapidly: only
  // the latest requested load is allowed to commit its result.
  const loadSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = (loadSeq.current += 1);
    fetchManifest()
      .then(async (loadedManifest) => {
        const entry = resolveSpecEntry(loadedManifest, readSpecParam());
        const text = await fetchSpecText(entry.url);
        if (cancelled || seq !== loadSeq.current) {
          return;
        }
        setManifest(loadedManifest);
        setActiveSpecId(entry.id);
        const result = compileSpec(text);
        if (result.ok) {
          setState({
            status: 'ready',
            compiled: result.compiled,
            revision: 0,
            text,
            originalText: text,
          });
        } else {
          setState({ status: 'invalid', errors: result.errors });
        }
      })
      .catch((reason: unknown) => {
        if (cancelled || seq !== loadSeq.current) {
          return;
        }
        setState({
          status: 'fetch-error',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The editor hands up an already-compiled spec + its text; bump the revision
  // to remount the dashboard subtree (resetting all Selection state) and keep
  // the originally-fetched text so Reset can restore it.
  const applySpec = useCallback((compiled: CompiledSpec, text: string) => {
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            compiled,
            text,
            revision: prev.revision + 1,
          }
        : prev,
    );
  }, []);

  // Quick-load: switch to another manifest spec. Writes `?spec=<id>`, fetches the
  // YAML fresh, and (on success) replaces the editor's text/originalText and bumps
  // the revision to remount — discarding any unsaved editor edits by design.
  const selectSpec = useCallback(
    (id: string) => {
      if (manifest === null) {
        return;
      }
      const entry = manifest.specs.find((candidate) => candidate.id === id);
      if (entry === undefined) {
        return;
      }
      writeSpecParam(id);
      setActiveSpecId(id);
      const seq = (loadSeq.current += 1);
      fetchSpecText(entry.url)
        .then((text) => {
          if (seq !== loadSeq.current) {
            return;
          }
          const result = compileSpec(text);
          if (result.ok) {
            setState((prev) => ({
              status: 'ready',
              compiled: result.compiled,
              revision: prev.status === 'ready' ? prev.revision + 1 : 0,
              text,
              originalText: text,
            }));
          } else {
            setState({ status: 'invalid', errors: result.errors });
          }
        })
        .catch((reason: unknown) => {
          if (seq !== loadSeq.current) {
            return;
          }
          setState({
            status: 'fetch-error',
            message: reason instanceof Error ? reason.message : String(reason),
          });
        });
    },
    [manifest],
  );

  if (state.status === 'loading') {
    return <CenteredNote>Loading spec…</CenteredNote>;
  }
  if (state.status === 'fetch-error') {
    return (
      <CenteredNote tone="error" testId="spec-fetch-error">
        Failed to load spec: {state.message}
      </CenteredNote>
    );
  }
  if (state.status === 'invalid') {
    return <SpecErrorPanel errors={state.errors} />;
  }

  return (
    <MosaicProvider coordinator={coordinator}>
      {/* Key on connection + spec revision: applying/switching a spec or
          recreating the connection remounts the topology subtree, resetting all
          Selection state cleanly. */}
      <SpecDashboard
        key={`${connectionId}:${state.revision}`}
        compiled={state.compiled}
        coordinator={coordinator}
        text={state.text}
        originalText={state.originalText}
        onApply={applySpec}
        manifest={manifest}
        activeSpecId={activeSpecId}
        onSelectSpec={selectSpec}
      />
    </MosaicProvider>
  );
}

function SpecDashboard(props: {
  compiled: CompiledSpec;
  coordinator: Coordinator;
  text: string;
  originalText: string;
  onApply: (compiled: CompiledSpec, text: string) => void;
  manifest: SpecManifest | null;
  activeSpecId: string | null;
  onSelectSpec: (id: string) => void;
}) {
  const { compiled, coordinator } = props;
  const load = useDataLoad(coordinator, compiled.spec.data.tables);
  const topology = useTopology(
    compiled.topologyConfig,
    compiled.topologyOptions,
  );
  const enabled = load.done && load.error === null;

  return (
    <MosaicTopologyProvider topology={topology}>
      <DashboardBody
        spec={compiled.spec}
        kindRegistry={compiled.kindRegistry}
        enabled={enabled}
        loadError={load.error}
        text={props.text}
        originalText={props.originalText}
        onApply={props.onApply}
        manifest={props.manifest}
        activeSpecId={props.activeSpecId}
        onSelectSpec={props.onSelectSpec}
      />
    </MosaicTopologyProvider>
  );
}

/**
 * Read the primary filter-set entry's declared `context` ref (`filters.context`
 * in the spec), which the facet option queries cascade by. Undefined when the
 * entry declares no context.
 */
function filterSetContextRef(spec: DashboardSpec): string | undefined {
  const entry = spec.topology[FILTERS_ENTRY];
  return entry !== undefined && entry.type === 'filter-set'
    ? entry.context
    : undefined;
}

function DashboardBody(props: {
  spec: DashboardSpec;
  kindRegistry: CompiledSpec['kindRegistry'];
  enabled: boolean;
  loadError: Error | null;
  text: string;
  originalText: string;
  onApply: (compiled: CompiledSpec, text: string) => void;
  manifest: SpecManifest | null;
  activeSpecId: string | null;
  onSelectSpec: (id: string) => void;
}) {
  const { spec, enabled, loadError } = props;
  // Read the topology provided by `SpecDashboard`'s `MosaicTopologyProvider`
  // (never build a second one here).
  const topology = useMosaicTopology();

  // Which expandable widget is currently enlarged. Lives here so it survives
  // the enlarge/return remount of the widget; the page-level FilterSet keeps
  // each widget's selection state across the move.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The spec-editor open state is lifted here so the toggle can live in the
  // Grafana toolbar while its panel renders below. This subtree remounts on a
  // successful Apply (revision-keyed), collapsing the editor; an invalid Apply
  // leaves the subtree intact, so the panel stays open to show its errors.
  const [editorOpen, setEditorOpen] = useState(false);

  // The spec's `widgets` is already a record keyed by id (the compile boundary
  // injected each key back as `widget.id`), so a layout `ref` resolves by direct
  // key access — no `.find` / Map build needed.
  const widgetsById = spec.widgets;

  const filterSet = useMemo(() => getPrimaryFilterSet(topology), [topology]);

  // The context Selection the facet option queries cascade by, resolved from the
  // filter-set entry's declared `context` ref.
  const pageContext = useMemo(
    () => resolveSelection(topology, filterSetContextRef(spec)),
    [topology, spec],
  );

  // Fallback table for facet fields that omit `facet_table`: the last declared
  // table (the derived relation every widget reads).
  const defaultFacetTable = useMemo(() => {
    const keys = Object.keys(spec.data.tables);
    return keys[keys.length - 1] ?? '';
  }, [spec.data.tables]);

  // Kind names that emit their own routing targets, so the builder must not
  // stamp a decorative `spec.target` on their specs.
  const selfRoutingKinds = useMemo(
    () => buildSelfRoutingKindNames(spec),
    [spec],
  );

  const context = useMemo<WidgetContext>(
    () => ({
      topology,
      filterSet,
      enabled,
      expandedId,
      onExpand: (id: string) => setExpandedId(id),
      onRestore: () => setExpandedId(null),
    }),
    [topology, filterSet, enabled, expandedId],
  );

  const title = spec.title ?? DEFAULT_TITLE;

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      {/* Slim Grafana toolbar — title + icon left, controls right, no color band. */}
      <header className="sticky top-0 z-20 flex h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div className="flex items-center gap-2">
          <DashboardGlyph />
          <h1 className="text-sm font-semibold tracking-tight text-ink">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <SpecSelect
            manifest={props.manifest}
            activeSpecId={props.activeSpecId}
            onSelectSpec={props.onSelectSpec}
          />
          <SpecEditorToggle
            open={editorOpen}
            onToggle={() => setEditorOpen((prev) => !prev)}
          />
        </div>
      </header>

      {loadError !== null ? (
        <div className="border-l-2 border-gf-red bg-gf-red/10 px-4 py-2 text-xs text-ink">
          Data load failed: {loadError.message}
        </div>
      ) : null}

      {/* Panel-edit code area, revealed below the toolbar when toggled open. */}
      <SpecEditorPanel
        open={editorOpen}
        text={props.text}
        originalText={props.originalText}
        onApply={props.onApply}
      />

      {/* Template-variables strip: the filter builder + active filter pills. */}
      <div className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-2">
        <FilterBuilder
          fields={spec.filters.fields}
          filterSet={filterSet}
          kindRegistry={props.kindRegistry}
          selfRoutingKinds={selfRoutingKinds}
          page={pageContext}
          defaultFacetTable={defaultFacetTable}
          enabled={enabled}
        />
        <ActiveFilterBar topology={topology} filterSet={filterSet} />
      </div>

      {/* Dense panel grid — 8px gaps, rectangular panels. */}
      <div className="flex flex-1 flex-col gap-2 p-2">
        {spec.layout.rows.map((row, rowIndex) => (
          <LayoutRow
            key={rowIndex}
            row={row}
            columns={spec.layout.columns}
            widgetsById={widgetsById}
            context={context}
          />
        ))}
      </div>
    </div>
  );
}

/** A small dashboards-style glyph for the toolbar title (decorative). */
function DashboardGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 text-gf-orange"
      fill="currentColor"
    >
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="4" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="7" width="6" height="8" rx="1" />
    </svg>
  );
}

function LayoutRow(props: {
  row: LayoutSpec['rows'][number];
  columns: number;
  widgetsById: Record<string, WidgetSpec>;
  context: WidgetContext;
}) {
  const { row, columns, widgetsById, context } = props;
  const gridColsClass = GRID_COLS[columns] ?? GRID_COLS[1]!;

  // When an expandable widget in this row is enlarged, its grid slot renders the
  // `placeholder` and the full-width `promoted` copy renders below the row.
  const expandedEntry = row.widgets.find(
    (entry) => entry.ref === context.expandedId,
  );
  const expandedWidget =
    expandedEntry === undefined ? undefined : widgetsById[expandedEntry.ref];

  return (
    <>
      <div className={`grid gap-2 ${gridColsClass}`}>
        {row.widgets.map((entry) => {
          const widget = widgetsById[entry.ref];
          if (widget === undefined) {
            return null;
          }
          const Component = widgetRegistry[widget.renderer];
          const spanClass = SPAN_CLASS[entry.span] ?? '';
          const mode =
            entry.ref === context.expandedId ? 'placeholder' : 'default';
          return (
            <div key={entry.ref} className={spanClass}>
              <Component widget={widget} context={context} mode={mode} />
            </div>
          );
        })}
      </div>
      {expandedWidget !== undefined
        ? (() => {
            const Component = widgetRegistry[expandedWidget.renderer];
            return (
              <div className="w-full">
                <Component
                  widget={expandedWidget}
                  context={context}
                  mode="promoted"
                />
              </div>
            );
          })()
        : null}
    </>
  );
}

/**
 * Quick-load selector: a labeled `<select>` of the manifest's specs. Changing it
 * writes `?spec=<id>` and loads that spec fresh (via `onSelectSpec`). Renders
 * nothing until the manifest + active id are known. All option ids/labels come
 * from the manifest (data), so no domain vocabulary lives here.
 */
function SpecSelect(props: {
  manifest: SpecManifest | null;
  activeSpecId: string | null;
  onSelectSpec: (id: string) => void;
}) {
  const { manifest, activeSpecId, onSelectSpec } = props;
  if (manifest === null || activeSpecId === null) {
    return null;
  }
  return (
    <label className="flex items-center overflow-hidden rounded-gf border border-line text-xs">
      <span className="bg-panel-header px-2 py-1 font-medium text-muted">
        Dashboard
      </span>
      <select
        data-testid="spec-select"
        value={activeSpecId}
        onChange={(event) => onSelectSpec(event.target.value)}
        className="h-7 cursor-pointer border-l border-line bg-field px-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
      >
        {manifest.specs.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SpecErrorPanel(props: { errors: Array<string> }) {
  return (
    <div className="min-h-screen bg-page p-8">
      <div
        data-testid="spec-error-panel"
        className="mx-auto max-w-3xl rounded-gf border border-line border-l-2 border-l-gf-red bg-panel p-6"
      >
        <h1 className="text-sm font-semibold text-gf-red">
          Spec validation failed
        </h1>
        <p className="mt-1 text-xs text-muted">
          The dashboard spec did not compile. Fix the following and reload:
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-6 text-xs text-ink">
          {props.errors.map((error, index) => (
            <li key={index} className="font-mono text-xs">
              {error}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CenteredNote(props: {
  children: React.ReactNode;
  tone?: 'default' | 'error';
  testId?: string;
}) {
  const toneClass = props.tone === 'error' ? 'text-gf-red' : 'text-muted';
  return (
    <div
      data-testid={props.testId}
      className={`flex h-screen items-center justify-center bg-page text-sm ${toneClass}`}
    >
      {props.children}
    </div>
  );
}

export default App;
