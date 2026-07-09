/**
 * The dashboard spec schema — the entire contract between the spec YAML
 * (`public/spec/*.yaml`) and the interpreter. Everything the app renders is validated here first; the
 * inferred TypeScript types (exported at the bottom) are the single source of
 * truth every downstream module (query compiler, topology builder, kind
 * registry, plot interpreter, widget registry) consumes.
 *
 * ## Two design rules this schema enforces
 *
 * 1. **snake_case everywhere.** Every spec KEY is `lower_snake_case`
 *    (`filter_by`, `having_by`, `metric_label`, `page_size`, `accessor_key`,
 *    `value_kind`, `array_column`, `facet_table`, `spec_id`, `spec_column`,
 *    `group_by`, `bridge_columns`, …). The libraries' camelCase types
 *    (`TopologyConfig`, `FilterSpec`, `FilterBridgeColumns`, the vgplot API) are
 *    reached only at the compile boundary — never in the spec.
 * 2. **The app is a pure interpreter.** Widgets are keyed by a generic
 *    `renderer:` (one of four domain-blind renderers), never by a bespoke widget
 *    type; filter behavior is instantiated from a generic `filter_kinds:`
 *    section (behavior factories in code); the vgplot plot is declared with an
 *    app-owned plot DSL. No domain knowledge lives in `src/`.
 *
 * The schema is intentionally strict (`.strict()` on every object) so a typo in
 * the YAML surfaces as a precise validation error rather than a silently-ignored
 * key.
 */
import { z } from 'zod';

// ── Query forms ──────────────────────────────────────────────────────────────

/**
 * Raw-template query (the primary idiom): a SQL statement with `{{where}}` /
 * `{{having}}` placeholders the query compiler substitutes with the stringified
 * cross-filter predicates. Used by kpi-card and selection-table renderers.
 */
export const rawTemplateQuerySchema = z
  .object({
    type: z.literal('sql'),
    statement: z.string().min(1),
  })
  .strict();

/**
 * Structured query form: an alias→expression select over a base table with
 * optional static `where` / `group_by` / `having` raw-SQL fragments. The
 * compiler routes simple column names / dotted struct paths through the
 * library's `SqlIdentifier` + `createStructAccess`; anything else is treated as
 * a raw SQL expression. Used by the data-table renderer.
 */
export const structuredQuerySchema = z
  .object({
    type: z.literal('select'),
    from: z.string().min(1),
    select: z.record(z.string(), z.string()),
    where: z.array(z.string()).optional(),
    group_by: z.array(z.string()).optional(),
    having: z.array(z.string()).optional(),
  })
  .strict();

export const querySchema = z.discriminatedUnion('type', [
  rawTemplateQuerySchema,
  structuredQuerySchema,
]);

// ── Data section ─────────────────────────────────────────────────────────────

export const dataSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('parquet'), url: z.string().min(1) }).strict(),
  z.object({ type: z.literal('csv'), url: z.string().min(1) }).strict(),
  z.object({ type: z.literal('json'), url: z.string().min(1) }).strict(),
  z.object({ type: z.literal('sql'), query: z.string().min(1) }).strict(),
]);

export const dataSchema = z
  .object({
    // Record insertion order is load order — a derived `sql` table may
    // reference tables declared before it.
    tables: z.record(z.string(), dataSourceSchema),
  })
  .strict();

// ── Topology section ─────────────────────────────────────────────────────────
//
// The declaration KEYS (`type`, `label`, `meta`, `reset`, `include`, `as`,
// `targets`, `context`) are the library `TopologyConfig` vocabulary and are
// already single-word; only the entry NAMES the author chooses are snake_case.
// After zod validation this section is a `TopologyConfig` — `toTopologyConfig`
// is a typed pass-through.

const selectionStrategySchema = z.enum([
  'intersect',
  'union',
  'single',
  'crossfilter',
]);

const declarationBase = {
  label: z.string().optional(),
  meta: z.unknown().optional(),
  reset: z.boolean().optional(),
};

const standaloneDeclarationSchema = z
  .object({
    type: selectionStrategySchema,
    ...declarationBase,
  })
  .strict();

const composeDeclarationSchema = z
  .object({
    type: z.literal('compose'),
    include: z.array(z.string()).min(1),
    as: z.enum(['intersect', 'crossfilter']).optional(),
    ...declarationBase,
  })
  .strict();

const filterSetDeclarationSchema = z
  .object({
    type: z.literal('filter-set'),
    targets: z.record(z.string(), selectionStrategySchema),
    context: z.string().optional(),
    ...declarationBase,
  })
  .strict();

export const topologyDeclarationSchema = z.discriminatedUnion('type', [
  standaloneDeclarationSchema,
  composeDeclarationSchema,
  filterSetDeclarationSchema,
]);

export const topologySchema = z.record(z.string(), topologyDeclarationSchema);

// ── Filter kinds section (behavior factories, instantiated by the spec) ──────
//
// Each entry names a generic `behavior` (a factory shipped in code) and its
// `config`. The kind registry = library built-ins + these instantiated kinds.
// A behavior discriminator keeps `config` strongly typed; only
// `aggregate-threshold` ships for now.

export const thresholdOperatorSchema = z.enum(['gt', 'lt', 'gte', 'lte']);

/**
 * Config for the `aggregate-threshold` behavior: a per-group aggregate compared
 * against a threshold, emitting a HAVING clause on `having_target` and a
 * membership subquery on `members_target`. `aggregate` is a raw SQL fragment
 * (e.g. `max(<col>)`); `group_by` is a column / struct path.
 */
export const aggregateThresholdConfigSchema = z
  .object({
    table: z.string().min(1),
    group_by: z.string().min(1),
    aggregate: z.string().min(1),
    having_target: z.string().min(1),
    members_target: z.string().min(1),
    operators: z.array(thresholdOperatorSchema).min(1),
  })
  .strict();

export const filterKindDefSchema = z.discriminatedUnion('behavior', [
  z
    .object({
      behavior: z.literal('aggregate-threshold'),
      config: aggregateThresholdConfigSchema,
    })
    .strict(),
]);

export const filterKindsSchema = z.record(z.string(), filterKindDefSchema);

// ── Filters section (builder field catalog) ──────────────────────────────────

export const filterValueKindSchema = z.enum([
  'facet',
  'text',
  'number',
  'date',
]);

export const filterPlacementSchema = z
  .object({
    label: z.string().min(1),
    target: z.string().min(1),
    kind: z.string().min(1),
    spec_id: z.string().min(1),
    /** Overrides the field's column for this placement (e.g. metric group key). */
    spec_column: z.string().optional(),
  })
  .strict();

export const filterFieldSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    column: z.string().min(1),
    value_kind: filterValueKindSchema,
    /** Facet-only: the column is a DuckDB list/array. */
    array_column: z.boolean().optional(),
    /** Facet-only: the table the option query reads (defaults to the primary table). */
    facet_table: z.string().optional(),
    placements: z.array(filterPlacementSchema).min(1),
  })
  .strict();

export const filtersSchema = z
  .object({
    fields: z.array(filterFieldSchema),
  })
  .strict();

// ── vgplot plot DSL (app-owned) ──────────────────────────────────────────────

/** X/Y (and r/opacity) channel encodings. */
export const binEncodingSchema = z.object({ bin: z.string().min(1) }).strict();
export const aggEncodingSchema = z
  .object({
    agg: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    column: z.string().min(1).optional(),
  })
  .strict();
export const dateBinEncodingSchema = z
  .object({
    date_bin: z.string().min(1),
    interval: z.enum(['day', 'week', 'month']),
  })
  .strict();

/** A field encoding object — bin, aggregate, or date bin. */
export const fieldEncodingSchema = z.union([
  binEncodingSchema,
  aggEncodingSchema,
  dateBinEncodingSchema,
]);

/**
 * A positional/size channel value: a bare column name (string), a constant
 * number, or a field encoding object.
 */
export const channelSchema = z.union([
  z.string().min(1),
  z.number(),
  fieldEncodingSchema,
]);

/**
 * A color channel value (`fill`/`stroke`): a CSS color string OR a bare column
 * name. Resolution is delegated to vgplot/Observable Plot, which treats a valid
 * CSS color as a constant and any other string as a categorical field — so the
 * interpreter stays domain-blind and never inspects the string.
 */
export const colorChannelSchema = z.string().min(1);

/** Per-mark data source: a base table, optionally cascaded by a topology ref. */
export const plotMarkDataSchema = z
  .object({
    from: z.string().min(1),
    filter_by: z.string().min(1).optional(),
  })
  .strict();

export const plotMarkSchema = z
  .object({
    mark: z.enum(['rectY', 'dot', 'lineY', 'areaY', 'regressionY']),
    data: plotMarkDataSchema,
    x: channelSchema.optional(),
    y: channelSchema.optional(),
    fill: colorChannelSchema.optional(),
    stroke: colorChannelSchema.optional(),
    r: channelSchema.optional(),
    opacity: channelSchema.optional(),
  })
  .strict();

/**
 * Brush styling (snake_case), mapped to vgplot's camelCase at build time. Kept
 * separate from geometry: this is semantic (color), not size.
 */
export const brushStyleSchema = z
  .object({
    fill: z.string().min(1).optional(),
    fill_opacity: z.number().optional(),
    stroke: z.string().min(1).optional(),
    stroke_opacity: z.number().optional(),
    stroke_width: z.number().optional(),
  })
  .strict();

export const plotSelectSchema = z
  .object({
    select: z.enum(['intervalX', 'intervalXY', 'toggle']),
    /** Topology selection NAME the interactor publishes into. */
    as: z.string().min(1),
    brush: brushStyleSchema.optional(),
    /** `toggle` only: the channels the point clause tests (e.g. `[x]`, `[fill]`). */
    channels: z
      .array(z.enum(['x', 'y', 'z', 'fill', 'stroke', 'color']))
      .optional(),
  })
  .strict();

/** Plot-level scale kinds. */
export const scaleKindSchema = z.enum([
  'linear',
  'log',
  'sqrt',
  'pow',
  'symlog',
  'time',
  'utc',
  'band',
  'point',
  'ordinal',
]);

/**
 * The plot node: marks + selects + plot-level SEMANTIC attributes only. There is
 * deliberately NO width/height/margins/size vocabulary — geometry is the
 * renderer's concern, injected by the caller (see plot-interpreter).
 */
export const plotSchema = z
  .object({
    marks: z.array(plotMarkSchema).min(1),
    selects: z.array(plotSelectSchema).optional(),
    x_scale: scaleKindSchema.optional(),
    y_scale: scaleKindSchema.optional(),
    /** `fixed` → the discovered domain is frozen (vgplot `Fixed`). */
    x_domain: z.literal('fixed').optional(),
    y_domain: z.literal('fixed').optional(),
    xy_domain: z.literal('fixed').optional(),
    /** A string label, or `null` to hide the axis label. */
    x_label: z.string().nullable().optional(),
    y_label: z.string().nullable().optional(),
    x_ticks: z.number().optional(),
    y_ticks: z.number().optional(),
    color_domain: z
      .union([z.literal('fixed'), z.array(z.union([z.string(), z.number()]))])
      .optional(),
  })
  .strict();

// ── Widget building blocks ─────────────────────────────────────────────────

export const sparklineXSchema = z
  .object({
    column: z.string().min(1),
    step: z.number().optional(),
    interval: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  })
  .strict();

export const sparklineYSchema = z
  .object({
    agg: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    column: z.string().optional(),
  })
  .strict();

/**
 * The selection-table sparkline: an EXPLICIT source (`table` + `key`) plus the
 * x/y measure. No implicit FROM-regex derivation — the schema carries the
 * source outright.
 */
export const sparklineSchema = z
  .object({
    table: z.string().min(1),
    key: z.string().min(1),
    x: sparklineXSchema,
    y: sparklineYSchema,
  })
  .strict();

export const selectionPublishSchema = z
  .object({
    spec_id: z.string().min(1),
    label: z.string().min(1),
    /** Row fields whose values populate the published tuples. */
    columns: z.array(z.string()).min(1),
    /** SQL fields the predicate tests, index-aligned with `columns`. */
    fields: z.array(z.string()).min(1),
  })
  .strict();

export const metricThresholdSchema = z
  .object({
    spec_id: z.string().min(1),
    /** Registry kind (must exist in the kind registry — an instantiated kind). */
    kind: z.string().min(1),
    /** Group-by column: the spec column and the membership group key. */
    group_by: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

export const dataColumnSchema = z
  .object({
    accessor_key: z.string().min(1),
    header: z.string().min(1),
    size: z.number().optional(),
  })
  .strict();

export const bridgeColumnSchema = z
  .object({
    column: z.string().optional(),
    clause: z.enum(['equals', 'ilike', 'prefix', 'range', 'date-range', 'in']),
    label: z.string().optional(),
    target: z.string().optional(),
  })
  .strict();

// ── Widgets (discriminated on `renderer`) ────────────────────────────────────

/**
 * Free-form per-widget metadata, opaque to the schema and interpreted (or
 * ignored) by the individual renderer. Renderers must tolerate absent metadata
 * and unknown keys — never throw on `meta` contents (smart-renderer principle).
 * Present on every widget variant. The one shipped capability: the data-table
 * renderer honors `meta: { exportable: true }` with a client-side CSV export.
 */
const widgetMeta = {
  meta: z.record(z.string(), z.unknown()).optional(),
};

export const kpiCardWidgetSchema = z
  .object({
    renderer: z.literal('kpi-card'),
    label: z.string().min(1),
    /** Formatter registry key. */
    format: z.string().min(1),
    /** Omitting `filter_by` opts the widget out of the cross-filter topology. */
    filter_by: z.string().optional(),
    query: rawTemplateQuerySchema,
    ...widgetMeta,
  })
  .strict();

export const selectionTableWidgetSchema = z
  .object({
    renderer: z.literal('selection-table'),
    title: z.string().min(1),
    metric_label: z.string().min(1),
    filter_by: z.string().min(1),
    having_by: z.string().optional(),
    expandable: z.boolean().optional().default(false),
    query: rawTemplateQuerySchema,
    publish: selectionPublishSchema,
    sparkline: sparklineSchema.optional(),
    metric_threshold: metricThresholdSchema.optional(),
    ...widgetMeta,
  })
  .strict();

export const dataTableWidgetSchema = z
  .object({
    renderer: z.literal('data-table'),
    title: z.string().min(1),
    filter_by: z.string().min(1),
    page_size: z.number().optional().default(20),
    query: structuredQuerySchema,
    columns: z.array(dataColumnSchema).min(1),
    bridge_columns: z.record(z.string(), bridgeColumnSchema),
    ...widgetMeta,
  })
  .strict();

export const vgplotWidgetSchema = z
  .object({
    renderer: z.literal('vgplot'),
    label: z.string().min(1),
    expandable: z.boolean().optional().default(false),
    plot: plotSchema,
    ...widgetMeta,
  })
  .strict();

export const widgetSchema = z.discriminatedUnion('renderer', [
  kpiCardWidgetSchema,
  selectionTableWidgetSchema,
  dataTableWidgetSchema,
  vgplotWidgetSchema,
]);

/**
 * The widgets section: a MAP keyed by widget id (consistent with `topology` and
 * `filter_kinds`), so the key IS the id and no `id` field lives in the widget
 * value. `renderer` stays the per-widget discriminator. The record's iteration
 * order is its declaration order (non-numeric string keys), which the compile
 * boundary preserves when it injects each key back as `id`. A non-empty map is
 * required (the array form was `.min(1)`).
 */
export const widgetsSchema = z
  .record(z.string().min(1), widgetSchema)
  .refine((widgets) => Object.keys(widgets).length > 0, {
    message: 'at least one widget is required',
  });

// ── Layout section ───────────────────────────────────────────────────────────

export const layoutWidgetSchema = z
  .object({
    ref: z.string().min(1),
    span: z.number().int().min(1),
  })
  .strict();

export const layoutRowSchema = z
  .object({
    widgets: z.array(layoutWidgetSchema).min(1),
  })
  .strict();

export const layoutSchema = z
  .object({
    columns: z.number().int().min(1),
    rows: z.array(layoutRowSchema).min(1),
  })
  .strict();

// ── The whole spec ───────────────────────────────────────────────────────────

export const dashboardSpecSchema = z
  .object({
    /** Optional page title; the header falls back to a default when absent. */
    title: z.string().min(1).optional(),
    data: dataSchema,
    topology: topologySchema,
    filter_kinds: filterKindsSchema.optional(),
    filters: filtersSchema,
    widgets: widgetsSchema,
    layout: layoutSchema,
  })
  .strict();

// ── Inferred types (the public type surface for the whole example) ────────────

export type RawTemplateQuery = z.infer<typeof rawTemplateQuerySchema>;
export type StructuredQuery = z.infer<typeof structuredQuerySchema>;
export type QuerySpec = z.infer<typeof querySchema>;

export type DataSourceSpec = z.infer<typeof dataSourceSchema>;
export type DataSpec = z.infer<typeof dataSchema>;

export type TopologyDeclarationSpec = z.infer<typeof topologyDeclarationSchema>;
export type TopologySpec = z.infer<typeof topologySchema>;

export type ThresholdOperator = z.infer<typeof thresholdOperatorSchema>;
export type AggregateThresholdConfig = z.infer<
  typeof aggregateThresholdConfigSchema
>;
export type FilterKindDef = z.infer<typeof filterKindDefSchema>;
export type FilterKindsSpec = z.infer<typeof filterKindsSchema>;

export type FilterValueKind = z.infer<typeof filterValueKindSchema>;
export type FilterPlacementSpec = z.infer<typeof filterPlacementSchema>;
export type FilterFieldSpec = z.infer<typeof filterFieldSchema>;
export type FiltersSpec = z.infer<typeof filtersSchema>;

export type FieldEncodingSpec = z.infer<typeof fieldEncodingSchema>;
export type ChannelSpec = z.infer<typeof channelSchema>;
export type PlotMarkDataSpec = z.infer<typeof plotMarkDataSchema>;
export type PlotMarkSpec = z.infer<typeof plotMarkSchema>;
export type BrushStyleSpec = z.infer<typeof brushStyleSchema>;
export type PlotSelectSpec = z.infer<typeof plotSelectSchema>;
export type PlotSpec = z.infer<typeof plotSchema>;

export type SparklineSpec = z.infer<typeof sparklineSchema>;
export type SelectionPublishSpec = z.infer<typeof selectionPublishSchema>;
export type MetricThresholdSpec = z.infer<typeof metricThresholdSchema>;
export type DataColumnSpec = z.infer<typeof dataColumnSchema>;
export type BridgeColumnSpec = z.infer<typeof bridgeColumnSchema>;

// The widget `id` disappears from the YAML — it is the record KEY. The compile
// boundary injects it back onto each widget value (see `compile.ts`), so every
// downstream consumer keeps reading `widget.id`. These runtime types therefore
// carry `id`, while the schema variants above (the parse shape) do not.
export type KpiCardWidgetSpec = z.infer<typeof kpiCardWidgetSchema> & {
  id: string;
};
export type SelectionTableWidgetSpec = z.infer<
  typeof selectionTableWidgetSchema
> & { id: string };
export type DataTableWidgetSpec = z.infer<typeof dataTableWidgetSchema> & {
  id: string;
};
export type VgplotWidgetSpec = z.infer<typeof vgplotWidgetSchema> & {
  id: string;
};
export type WidgetSpec =
  | KpiCardWidgetSpec
  | SelectionTableWidgetSpec
  | DataTableWidgetSpec
  | VgplotWidgetSpec;
export type RendererName = WidgetSpec['renderer'];

export type LayoutWidgetSpec = z.infer<typeof layoutWidgetSchema>;
export type LayoutRowSpec = z.infer<typeof layoutRowSchema>;
export type LayoutSpec = z.infer<typeof layoutSchema>;

// The parse shape's `widgets` is a `Record<string, <widget minus id>>`. The
// normalized runtime spec (produced at the compile boundary) replaces it with a
// record of id-carrying {@link WidgetSpec} values, keyed by the same ids.
export type DashboardSpec = Omit<
  z.infer<typeof dashboardSpecSchema>,
  'widgets'
> & {
  widgets: Record<string, WidgetSpec>;
};
