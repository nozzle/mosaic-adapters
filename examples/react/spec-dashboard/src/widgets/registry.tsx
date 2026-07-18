/**
 * The widget component registry, keyed by the spec widget `renderer`. The
 * cross-reference validator checks every widget `renderer` against these keys.
 *
 * There are five generic, domain-blind renderers. Each entry accepts the union
 * {@link WidgetSpec} and narrows on `widget.renderer` (returning `null` on a
 * mismatch, which never happens because `App` looks the component up by that same
 * `renderer`). Data widgets resolve their own `filter_by` / `having_by`
 * Selections from `context.topology` and publish into `context.filterSet`; the
 * `variable-select` control resolves a topology-owned variable (Param) from that
 * same `context.topology` and drives it.
 */
import { DataTableWidget } from './detail-table';
import { KpiWidget } from './kpi';
import { SelectionTableWidget } from './summary-table';
import { VariableSelectWidget } from './variable-select';
import { VgplotWidget } from './vgplot-widget';
import type { ReactElement } from 'react';
import type { FilterSet, Topology } from '@nozzleio/react-mosaic';
import type { RendererName, WidgetSpec } from '../spec/schema';

/**
 * How a widget slot is being rendered. Only the expandable `selection-table`
 * reads it: `App` renders a `placeholder` in the grid slot and a `promoted`
 * full-width copy below the row when a table is enlarged; every other widget (and
 * the unexpanded state) is `default`.
 */
export type WidgetRenderMode = 'default' | 'promoted' | 'placeholder';

/**
 * Shared per-render context handed to every widget. A widget resolves its own
 * Selections from `topology` (via `resolveSelection`) and publishes filters into
 * `filterSet`. The expand controller is owned by `App`; expandable widgets call
 * `onExpand` / `onRestore` and read `expandedId` to render their controls.
 */
export interface WidgetContext {
  topology: Topology;
  filterSet: FilterSet;
  /** True once DuckDB has finished loading; widgets gate their queries on it. */
  enabled: boolean;
  /** The id of the currently enlarged expandable widget, or null. */
  expandedId: string | null;
  /** Enlarge a widget into the full-width promoted slot. */
  onExpand: (id: string) => void;
  /** Return the enlarged widget to its grid slot. */
  onRestore: () => void;
}

export interface WidgetComponentProps {
  widget: WidgetSpec;
  context: WidgetContext;
  /** Defaults to `'default'`; only `selection-table` varies on it. */
  mode?: WidgetRenderMode;
}

export type WidgetComponent = (
  props: WidgetComponentProps,
) => ReactElement | null;

export const widgetRegistry: Record<RendererName, WidgetComponent> = {
  'kpi-card': KpiWidget,
  'selection-table': SelectionTableWidget,
  'data-table': DataTableWidget,
  vgplot: VgplotWidget,
  'variable-select': VariableSelectWidget,
};

/** The registered renderer keys — consumed by cross-reference validation. */
export const rendererKeys: Array<RendererName> = Object.keys(
  widgetRegistry,
) as Array<RendererName>;
