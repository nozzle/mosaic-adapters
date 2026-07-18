/**
 * The vgplot plot interpreter — a pure module that compiles the app-owned plot
 * DSL (`plot:` nodes in the spec) into an ordered list of vgplot directives ready
 * to spread into `api.plot(...)`. It knows the DSL vocabulary and nothing about
 * any domain.
 *
 * ## The geometry-injection contract
 *
 * The DSL carries only SEMANTIC plot attributes (scales, domains, labels, ticks,
 * color domain). It has NO width/height/margins — geometry is the renderer's
 * concern. The caller (the vgplot renderer) supplies a
 * {@link PlotGeometry} object; {@link buildPlotSpec} appends it AFTER the
 * semantic attributes, so geometry always wins for the keys it sets (width,
 * height, margins, and tick-count overrides). The renderer drives sizing with a
 * ResizeObserver: it can rebuild with a fresh geometry, or (to preserve a live
 * brush overlay) mutate the built plot's `width`/`height`/`margin*`/`*Ticks`
 * attributes in place — the exact set this module writes as geometry directives.
 *
 * ## vgplot API verification (against @uwdata/vgplot 0.28)
 *
 * - marks: `rectY`, `dot`, `lineY`, `areaY`, `regressionY` — `(data, channels)`.
 * - `from(table, { filterBy })` — the mark data source.
 * - encodings: `bin(col, { interval? })` (temporal when `interval` is set),
 *   `count()`, `sum/avg/min/max(col)`.
 * - interactors: `intervalX({ as, brush })`, `intervalXY({ as, brush })`,
 *   `toggle({ as, channels, brush })`. **`toggle` DOES take a topology Selection
 *   cleanly via `as`** (verified in `node_modules/@uwdata/vgplot/src/plot/
 *   interactors.js`: `toggle({ as, ...rest }) => Toggle{ selection: as }`).
 *   Its one constraint: `Toggle` needs a `channels` array (`toggleX`/`toggleColor`
 *   are just `toggle` with `channels` preset), so the DSL requires `channels:`
 *   for a `toggle` select (enforced here — a `toggle` with no channels is a spec
 *   error).
 * - attributes: `xScale`/`yScale`, `xDomain`/`yDomain`/`xyDomain` (value
 *   `Fixed`), `colorDomain`, `xLabel`/`yLabel`, `xTicks`/`yTicks`,
 *   `width`/`height`/`margin{Top,Right,Bottom,Left}`.
 * - `Fixed` — the sentinel that freezes a discovered domain.
 *
 * fill/stroke strings pass straight through to vgplot/Observable Plot, which
 * resolves a valid CSS color as a constant and any other string as a categorical
 * field. The interpreter never inspects the string (domain-blindness).
 */
import { column } from '@uwdata/mosaic-sql';
import { parseVariableRef } from './query-compiler';
import type { Selection } from '@uwdata/mosaic-core';
import type { ParamLike } from '@uwdata/mosaic-sql';
import type {
  BrushStyleSpec,
  ChannelSpec,
  FieldEncodingSpec,
  PlotMarkSpec,
  PlotSelectSpec,
  PlotSpec,
} from './schema';

// ── The vgplot API surface this module drives ────────────────────────────────
//
// `createAPIContext()` is typed `any` upstream, so the caller narrows it to this
// structural interface once at the boundary. Every builder returns an opaque
// directive / encoding — the interpreter never inspects them.

/** An opaque vgplot plot directive (mark, interactor, or attribute). */
export type PlotDirective = unknown;
/** An opaque vgplot channel encoding (a `bin`/`count`/… result or a literal). */
export type PlotEncoding = unknown;
/** An opaque vgplot mark data source (`from(...)`). */
export type PlotDataSource = unknown;

/** Channel object handed to a mark builder. */
export type PlotChannels = Record<string, PlotEncoding>;

/** The subset of the vgplot API context the interpreter calls. */
export interface PlotApi {
  from: (table: string, options?: { filterBy?: Selection }) => PlotDataSource;

  rectY: (data: PlotDataSource, channels: PlotChannels) => PlotDirective;
  dot: (data: PlotDataSource, channels: PlotChannels) => PlotDirective;
  lineY: (data: PlotDataSource, channels: PlotChannels) => PlotDirective;
  areaY: (data: PlotDataSource, channels: PlotChannels) => PlotDirective;
  regressionY: (data: PlotDataSource, channels: PlotChannels) => PlotDirective;

  bin: (
    column: string,
    options?: { interval?: string; step?: number },
  ) => PlotEncoding;
  count: () => PlotEncoding;
  sum: (column: string) => PlotEncoding;
  avg: (column: string) => PlotEncoding;
  min: (column: string) => PlotEncoding;
  max: (column: string) => PlotEncoding;

  intervalX: (options: {
    as?: Selection;
    brush?: BrushVgStyle;
  }) => PlotDirective;
  intervalXY: (options: {
    as?: Selection;
    brush?: BrushVgStyle;
  }) => PlotDirective;
  toggle: (options: {
    as?: Selection;
    channels: Array<string>;
    brush?: BrushVgStyle;
  }) => PlotDirective;

  xScale: (value: string) => PlotDirective;
  yScale: (value: string) => PlotDirective;
  xDomain: (value: unknown) => PlotDirective;
  yDomain: (value: unknown) => PlotDirective;
  xyDomain: (value: unknown) => PlotDirective;
  colorDomain: (value: unknown) => PlotDirective;
  xLabel: (value: string | null) => PlotDirective;
  yLabel: (value: string | null) => PlotDirective;
  xTicks: (value: number) => PlotDirective;
  yTicks: (value: number) => PlotDirective;

  width: (value: number) => PlotDirective;
  height: (value: number) => PlotDirective;
  marginTop: (value: number) => PlotDirective;
  marginRight: (value: number) => PlotDirective;
  marginBottom: (value: number) => PlotDirective;
  marginLeft: (value: number) => PlotDirective;

  /** The sentinel that freezes a discovered domain. */
  readonly Fixed: unknown;
}

/** vgplot's camelCase brush style (the mapped form of {@link BrushStyleSpec}). */
export interface BrushVgStyle {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}

/**
 * Renderer-supplied geometry, merged AFTER the DSL's semantic attributes. Every
 * field is optional; only the ones present are emitted. `xTicks`/`yTicks`
 * override the DSL's `x_ticks`/`y_ticks`.
 */
export interface PlotGeometry {
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  xTicks?: number;
  yTicks?: number;
}

/** An explicit `[lo, hi]` axis domain (numeric or temporal bounds). */
export type DomainBounds = readonly [number | Date, number | Date];

/**
 * Caller-resolved explicit domains for `fixed` axes — the FULL unfiltered
 * extent of the axis's source column, computed once at build time (see
 * {@link collectFixedDomainRequests}). An absent axis falls back to vgplot's
 * `Fixed` sentinel (freeze-on-first-render), which is only correct when no
 * filter is active at mount.
 */
export interface FixedDomains {
  x?: DomainBounds;
  y?: DomainBounds;
  xy?: DomainBounds;
}

export interface PlotInterpreterDeps {
  /** The vgplot API context (`createAPIContext(...)`), narrowed to {@link PlotApi}. */
  api: PlotApi;
  /**
   * Resolve a topology selection NAME to a live Selection (undefined when
   * unresolvable — validation rejects that ahead of build, so the build path
   * treats it as a spec error).
   */
  resolveSelection: (name: string) => Selection | undefined;
  /**
   * Resolve a declared variable NAME to its live Mosaic `Param` (a `ParamLike`).
   * A `$name` channel compiles to `column(param)` — the variable's value names
   * the encoded column, and vgplot's mark collects the param and re-initializes
   * on change (no client `params` needed on the vgplot path). Validation admits a
   * `$name` channel only for a declared variable, so a correct resolver never
   * fails here.
   */
  resolveVariable: (name: string) => ParamLike;
  /** Renderer-owned geometry (width/height/margins/tick overrides). */
  geometry: PlotGeometry;
  /**
   * Explicit `fixed`-axis domains the caller resolved to the unfiltered extent.
   * An axis absent here falls back to the vgplot `Fixed` sentinel.
   */
  fixedDomains?: FixedDomains;
}

/** Raised when the DSL contains vocabulary/refs validation should have caught. */
export class PlotSpecError extends Error {}

// ── Encodings ────────────────────────────────────────────────────────────────

function isFieldEncoding(value: ChannelSpec): value is FieldEncodingSpec {
  // Bare column (string) / constant (number) fail this; an encoding is an object.
  return typeof value === 'object';
}

/** Compile one channel value (bare column, constant, or encoding) to vgplot. */
function buildChannel(
  api: PlotApi,
  value: ChannelSpec,
  deps: PlotInterpreterDeps,
): PlotEncoding {
  if (!isFieldEncoding(value)) {
    // A bare `$name` variable ref → `column(param)` (a `ColumnParamNode`): the
    // variable's value names the encoded column, and the vgplot mark collects the
    // param and re-initializes on change. A non-ref string / constant number
    // passes through unchanged.
    if (typeof value === 'string') {
      const variable = parseVariableRef(value);
      if (variable !== null) {
        return column(deps.resolveVariable(variable));
      }
    }
    return value;
  }
  if ('bin' in value) {
    return api.bin(value.bin);
  }
  if ('date_bin' in value) {
    return api.bin(value.date_bin, { interval: value.interval });
  }
  // Aggregate encoding.
  switch (value.agg) {
    case 'count':
      return api.count();
    case 'sum':
    case 'avg':
    case 'min':
    case 'max': {
      const column = value.column;
      if (column === undefined) {
        throw new PlotSpecError(
          `aggregate '${value.agg}' requires a 'column'.`,
        );
      }
      return api[value.agg](column);
    }
    default: {
      const never: never = value.agg;
      throw new PlotSpecError(`unknown aggregate '${String(never)}'.`);
    }
  }
}

/**
 * A color channel value: a bare `$name` variable ref → `column(param)` (color by
 * the variable-named column); any other string passes through verbatim (vgplot
 * resolves a CSS color as a constant, any other string as a field).
 */
function buildColorChannel(
  value: string,
  deps: PlotInterpreterDeps,
): PlotEncoding {
  const variable = parseVariableRef(value);
  if (variable !== null) {
    return column(deps.resolveVariable(variable));
  }
  return value;
}

/** Assemble the mark's channel object from every present encoding. */
function buildChannels(
  mark: PlotMarkSpec,
  deps: PlotInterpreterDeps,
): PlotChannels {
  const { api } = deps;
  const channels: PlotChannels = {};
  if (mark.x !== undefined) {
    channels.x = buildChannel(api, mark.x, deps);
  }
  if (mark.y !== undefined) {
    channels.y = buildChannel(api, mark.y, deps);
  }
  if (mark.r !== undefined) {
    channels.r = buildChannel(api, mark.r, deps);
  }
  if (mark.opacity !== undefined) {
    channels.opacity = buildChannel(api, mark.opacity, deps);
  }
  if (mark.fill !== undefined) {
    channels.fill = buildColorChannel(mark.fill, deps);
  }
  if (mark.stroke !== undefined) {
    channels.stroke = buildColorChannel(mark.stroke, deps);
  }
  return channels;
}

// ── Marks ────────────────────────────────────────────────────────────────────

const MARK_BUILDERS: Record<
  PlotMarkSpec['mark'],
  (api: PlotApi, data: PlotDataSource, channels: PlotChannels) => PlotDirective
> = {
  rectY: (api, data, channels) => api.rectY(data, channels),
  dot: (api, data, channels) => api.dot(data, channels),
  lineY: (api, data, channels) => api.lineY(data, channels),
  areaY: (api, data, channels) => api.areaY(data, channels),
  regressionY: (api, data, channels) => api.regressionY(data, channels),
};

function buildMark(
  mark: PlotMarkSpec,
  deps: PlotInterpreterDeps,
): PlotDirective {
  const { api } = deps;
  // A vgplot mark binds its `filterBy` Selection natively and resolves it
  // wholesale, so `exclude` supports only the opt-out form here: `'all'` drops
  // the Selection entirely (identical to omitting `filter_by`). A list exclusion
  // has no per-clause hook on a native mark — validation rejects it ahead of
  // build, so its arrival is a spec error.
  const { exclude } = mark.data;
  if (Array.isArray(exclude)) {
    throw new PlotSpecError(
      `mark data.exclude list is not supported on a vgplot mark; use 'exclude: all' or a table renderer for a partial exclusion.`,
    );
  }
  let filterBy: Selection | undefined;
  if (mark.data.filter_by !== undefined && exclude !== 'all') {
    filterBy = deps.resolveSelection(mark.data.filter_by);
    if (filterBy === undefined) {
      throw new PlotSpecError(
        `mark data.filter_by '${mark.data.filter_by}' does not resolve to a selection.`,
      );
    }
  }
  const data = api.from(
    mark.data.from,
    filterBy !== undefined ? { filterBy } : undefined,
  );
  // MARK_BUILDERS is keyed by the full mark union, so this is always defined.
  return MARK_BUILDERS[mark.mark](api, data, buildChannels(mark, deps));
}

// ── Selects (interactors) ─────────────────────────────────────────────────────

/** Map the snake_case brush style onto vgplot's camelCase form. */
function toVgBrush(
  brush: BrushStyleSpec | undefined,
): BrushVgStyle | undefined {
  if (brush === undefined) {
    return undefined;
  }
  const vg: BrushVgStyle = {};
  if (brush.fill !== undefined) {
    vg.fill = brush.fill;
  }
  if (brush.fill_opacity !== undefined) {
    vg.fillOpacity = brush.fill_opacity;
  }
  if (brush.stroke !== undefined) {
    vg.stroke = brush.stroke;
  }
  if (brush.stroke_opacity !== undefined) {
    vg.strokeOpacity = brush.stroke_opacity;
  }
  if (brush.stroke_width !== undefined) {
    vg.strokeWidth = brush.stroke_width;
  }
  return vg;
}

function buildSelect(
  select: PlotSelectSpec,
  deps: PlotInterpreterDeps,
): PlotDirective {
  const { api } = deps;
  const as = deps.resolveSelection(select.as);
  if (as === undefined) {
    throw new PlotSpecError(
      `select.as '${select.as}' does not resolve to a topology selection.`,
    );
  }
  const brush = toVgBrush(select.brush);
  switch (select.select) {
    case 'intervalX':
      return api.intervalX({ as, ...(brush !== undefined ? { brush } : {}) });
    case 'intervalXY':
      return api.intervalXY({ as, ...(brush !== undefined ? { brush } : {}) });
    case 'toggle': {
      // `toggle` needs a channels array (see module doc); a missing one is a
      // spec error validation should have rejected.
      const channels = select.channels;
      if (channels === undefined || channels.length === 0) {
        throw new PlotSpecError(
          `select 'toggle' (as '${select.as}') requires a non-empty 'channels'.`,
        );
      }
      return api.toggle({
        as,
        channels,
        ...(brush !== undefined ? { brush } : {}),
      });
    }
    default: {
      const never: never = select.select;
      throw new PlotSpecError(`unknown select '${String(never)}'.`);
    }
  }
}

// ── Semantic + geometry attributes ────────────────────────────────────────────

function buildSemanticAttributes(
  plot: PlotSpec,
  deps: PlotInterpreterDeps,
): Array<PlotDirective> {
  const { api } = deps;
  const attrs: Array<PlotDirective> = [];
  if (plot.x_scale !== undefined) {
    attrs.push(api.xScale(plot.x_scale));
  }
  if (plot.y_scale !== undefined) {
    attrs.push(api.yScale(plot.y_scale));
  }
  // A `fixed` axis takes the caller-resolved unfiltered domain when present;
  // otherwise it falls back to vgplot's `Fixed` sentinel. The explicit domain is
  // the correct interpretation of `fixed` — the full extent regardless of the
  // filters active at mount — where `Fixed` freezes to the (possibly filtered)
  // first render (see the module + widget docstrings).
  if (plot.x_domain === 'fixed') {
    attrs.push(api.xDomain(deps.fixedDomains?.x ?? api.Fixed));
  }
  if (plot.y_domain === 'fixed') {
    attrs.push(api.yDomain(deps.fixedDomains?.y ?? api.Fixed));
  }
  if (plot.xy_domain === 'fixed') {
    attrs.push(api.xyDomain(deps.fixedDomains?.xy ?? api.Fixed));
  }
  if (plot.color_domain !== undefined) {
    attrs.push(
      api.colorDomain(
        plot.color_domain === 'fixed' ? api.Fixed : plot.color_domain,
      ),
    );
  }
  // Labels: a present key (even `null`) is emitted; `null` hides the label.
  if (plot.x_label !== undefined) {
    attrs.push(api.xLabel(plot.x_label));
  }
  if (plot.y_label !== undefined) {
    attrs.push(api.yLabel(plot.y_label));
  }
  if (plot.x_ticks !== undefined) {
    attrs.push(api.xTicks(plot.x_ticks));
  }
  if (plot.y_ticks !== undefined) {
    attrs.push(api.yTicks(plot.y_ticks));
  }
  return attrs;
}

/** Geometry directives, emitted AFTER semantic ones so the caller's sizing wins. */
function buildGeometryAttributes(
  deps: PlotInterpreterDeps,
): Array<PlotDirective> {
  const { api, geometry } = deps;
  const attrs: Array<PlotDirective> = [];
  if (geometry.width !== undefined) {
    attrs.push(api.width(geometry.width));
  }
  if (geometry.height !== undefined) {
    attrs.push(api.height(geometry.height));
  }
  if (geometry.marginTop !== undefined) {
    attrs.push(api.marginTop(geometry.marginTop));
  }
  if (geometry.marginRight !== undefined) {
    attrs.push(api.marginRight(geometry.marginRight));
  }
  if (geometry.marginBottom !== undefined) {
    attrs.push(api.marginBottom(geometry.marginBottom));
  }
  if (geometry.marginLeft !== undefined) {
    attrs.push(api.marginLeft(geometry.marginLeft));
  }
  if (geometry.xTicks !== undefined) {
    attrs.push(api.xTicks(geometry.xTicks));
  }
  if (geometry.yTicks !== undefined) {
    attrs.push(api.yTicks(geometry.yTicks));
  }
  return attrs;
}

// ── Fixed-domain resolution (pure request planning) ──────────────────────────

/**
 * A `fixed` axis that needs an explicit unfiltered domain, paired with the base
 * table + source column(s) whose extent bounds it. `x`/`y` carry one column; an
 * `xy` shared domain carries both (its bounds are the union of the two extents).
 */
export interface FixedDomainRequest {
  axis: 'x' | 'y' | 'xy';
  table: string;
  columns: Array<string>;
  /**
   * The axis is log-scaled, so the extent must span POSITIVE values only:
   * mosaic's log binning silently drops rows ≤ 0, so an extent that includes
   * them would stretch the domain below the data's rendered support and
   * degenerate the axis.
   */
  positiveOnly: boolean;
}

/**
 * The source column a channel queries for its extent, or `null` when the channel
 * is not a plain or binned column (a constant, an aggregate, or a temporal
 * `date_bin` — none of which pins the axis to a single numeric column, so the
 * axis falls back to vgplot `Fixed`).
 */
function channelColumn(channel: ChannelSpec | undefined): string | null {
  if (channel === undefined || typeof channel === 'number') {
    return null;
  }
  if (typeof channel === 'string') {
    return channel;
  }
  if ('bin' in channel) {
    return channel.bin;
  }
  return null;
}

/** The first mark whose channel (via `pick`) resolves to a plain/binned column. */
function firstColumnMark(
  plot: PlotSpec,
  pick: (mark: PlotMarkSpec) => ChannelSpec | undefined,
): { table: string; column: string } | null {
  for (const mark of plot.marks) {
    const column = channelColumn(pick(mark));
    if (column !== null) {
      return { table: mark.data.from, column };
    }
  }
  return null;
}

/**
 * Plan the extent queries a plot's `fixed` axes need: for each `fixed` axis
 * whose channel(s) resolve to a plain/binned column, the base table + column(s)
 * to read the FULL unfiltered extent from. An axis that cannot be pinned to a
 * single source column is omitted, so the interpreter falls back to `Fixed` for
 * it. Pure — the caller (which owns coordinator access) runs the queries.
 */
export function collectFixedDomainRequests(
  plot: PlotSpec,
): Array<FixedDomainRequest> {
  const requests: Array<FixedDomainRequest> = [];
  const xLog = plot.x_scale === 'log';
  const yLog = plot.y_scale === 'log';
  if (plot.x_domain === 'fixed') {
    const found = firstColumnMark(plot, (mark) => mark.x);
    if (found !== null) {
      requests.push({
        axis: 'x',
        table: found.table,
        columns: [found.column],
        positiveOnly: xLog,
      });
    }
  }
  if (plot.y_domain === 'fixed') {
    const found = firstColumnMark(plot, (mark) => mark.y);
    if (found !== null) {
      requests.push({
        axis: 'y',
        table: found.table,
        columns: [found.column],
        positiveOnly: yLog,
      });
    }
  }
  if (plot.xy_domain === 'fixed') {
    for (const mark of plot.marks) {
      const x = channelColumn(mark.x);
      const y = channelColumn(mark.y);
      if (x !== null && y !== null) {
        requests.push({
          axis: 'xy',
          table: mark.data.from,
          columns: [x, y],
          // A shared domain must satisfy the stricter of the two scales.
          positiveOnly: xLog || yLog,
        });
        break;
      }
    }
  }
  return requests;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compile a plot node into an ordered directive list to spread into
 * `api.plot(...)`: marks first, then interactors, then semantic attributes, then
 * caller geometry. Throws {@link PlotSpecError} on vocabulary/ref problems the
 * validator should have collected first.
 */
export function buildPlotSpec(
  plot: PlotSpec,
  deps: PlotInterpreterDeps,
): Array<PlotDirective> {
  const directives: Array<PlotDirective> = [];
  for (const mark of plot.marks) {
    directives.push(buildMark(mark, deps));
  }
  for (const select of plot.selects ?? []) {
    directives.push(buildSelect(select, deps));
  }
  directives.push(...buildSemanticAttributes(plot, deps));
  directives.push(...buildGeometryAttributes(deps));
  return directives;
}
