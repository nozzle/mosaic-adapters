/**
 * App-owned field catalog for the dynamic filter builder (issue #180).
 *
 * Each entry describes ONE canonical field the builder can author a filter
 * block for. A field declares one or more *placements*: a placement pairs a
 * routing `target` on the page {@link filterSet} with the `kind` (and therefore
 * the operator vocabulary) the block uses when that placement is selected.
 * When a field exposes more than one placement, the block renders a WHERE /
 * HAVING placement selector; the chosen placement drives which kind's
 * `operators` metadata populates the operator dropdown and which spec id the
 * block writes. Single-placement fields still render a (disabled) placement
 * control so the user always sees where a filter applies.
 *
 * ## The governing principle: Classic never limits the Builder
 *
 * Every field's canonical spec id + kind is deliberately shared with the app's
 * Classic top-bar control, so the two authoring views converge on ONE spec per
 * field and switching views hydrates losslessly in BOTH directions:
 *
 * - `Phrase`         → `text:phrase`      (condition, `phrase`)
 * - `Question`       → `text:question`    (condition, `related_phrase.phrase`)
 * - `Domain`         → `facet:domain`     (condition `in`, multi-select)
 * - `Device`         → `facet:device`     (condition `in`, multi-select)
 * - `Keyword Group`  → `facet:keyword-group` (condition `list_has_any`, array)
 * - `Requested Date` → `date:requested`   (interval, WHERE)
 * - `Search Volume`  → `built:search-volume` WHERE / `metric:phrase` HAVING
 * - `Min Domains`    → `minDomains`        (min-domains subquery, WHERE)
 *
 * Shared fields author the `condition` kind (not the old `point`/`points`/
 * `match` shapes) because only `condition` exposes changeable list operators
 * (`in`/`not_in`/`is_empty`/`is_not_empty`) and array operators
 * (`list_has_any`/`list_has_all`/`excludes_all`) the feedback requires.
 */

/**
 * The value control family a field's block renders (before operator arity
 * refines it):
 *
 * - `text`             → a single text input.
 * - `number`           → number input(s), one per operator-arity slot.
 * - `facet-multi`      → the shared multi-select facet list (scalar column).
 * - `facet-multi-array`→ the shared multi-select facet list (list/array column).
 * - `date-range`       → two date inputs (interval `value`/`valueTo`).
 */
export type FieldValueKind =
  | 'facet-multi'
  | 'facet-multi-array'
  | 'text'
  | 'number'
  | 'date-range';

/**
 * One authoring placement for a field: a routing target on the set plus the
 * kind whose operator vocabulary the block uses when this placement is active.
 */
export interface CatalogPlacement {
  /** Human-readable placement label (e.g. "per keyword (HAVING)"). */
  label: string;
  /** Routing target name on the page filterSet (`where`, `having:phrase`, …). */
  target: string;
  /** Registry kind the block resolves through for this placement. */
  kind: string;
  /**
   * Canonical spec id this placement writes. Placements of the same field write
   * to DIFFERENT ids when they route to different targets/kinds (e.g. the
   * per-row WHERE predicate vs the phrase card's shared metric spec), so
   * switching placement removes the prior spec and sets the new one.
   */
  specId: string;
  /**
   * Overrides the spec `column` for this placement. The metric-threshold
   * placement resolves through the phrase card's group-by column (`phrase`),
   * not the field's display column (`search_volume`) — the aggregate column is
   * baked into the card's `aggExpr`. Omitted → the field's `column` is used.
   */
  specColumn?: string;
}

export interface CatalogField {
  /** Canonical field id — one filter block per field id. */
  id: string;
  /** Field label (dropdown + block header + chip label). */
  label: string;
  /** Column name or struct path. */
  column: string;
  /** Value control family. */
  valueKind: FieldValueKind;
  /** Facet only: the column is a DuckDB list/array. */
  arrayColumn?: boolean;
  /** One or more placements; a placement selector renders when length > 1. */
  placements: Array<CatalogPlacement>;
}

/**
 * The eight-field catalog — full parity with the Classic view. Each field maps
 * to its Classic counterpart by a shared spec id (see the module header), so
 * the Builder is the full-power authoring surface and the Classic view a
 * curated subset that never limits it.
 */
export const FILTER_CATALOG: Array<CatalogField> = [
  {
    id: 'phrase',
    label: 'Phrase',
    column: 'phrase',
    valueKind: 'text',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'condition',
        specId: 'text:phrase',
      },
    ],
  },
  {
    id: 'domain',
    label: 'Domain',
    column: 'domain',
    valueKind: 'facet-multi',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'condition',
        specId: 'facet:domain',
      },
    ],
  },
  {
    id: 'device',
    label: 'Device',
    column: 'device',
    valueKind: 'facet-multi',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'condition',
        specId: 'facet:device',
      },
    ],
  },
  {
    id: 'keyword-group',
    label: 'Keyword Group',
    column: 'keyword_groups',
    valueKind: 'facet-multi-array',
    arrayColumn: true,
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'condition',
        specId: 'facet:keyword-group',
      },
    ],
  },
  {
    id: 'question',
    label: 'Question',
    column: 'related_phrase.phrase',
    valueKind: 'text',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'condition',
        specId: 'text:question',
      },
    ],
  },
  {
    id: 'requested-date',
    label: 'Requested Date',
    column: 'requested',
    valueKind: 'date-range',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'interval',
        specId: 'date:requested',
      },
    ],
  },
  {
    id: 'search-volume',
    label: 'Search Volume',
    column: 'search_volume',
    valueKind: 'number',
    placements: [
      {
        label: 'per row (WHERE)',
        target: 'where',
        kind: 'condition',
        specId: 'built:search-volume',
      },
      {
        label: 'per keyword (HAVING)',
        target: 'having:phrase',
        kind: 'metric-threshold',
        // Shares the phrase card's metric spec: builder + classic converge.
        specId: 'metric:phrase',
        // The metric kind groups by phrase; search_volume is the card's agg.
        specColumn: 'phrase',
      },
    ],
  },
  {
    id: 'min-domains',
    label: 'Min Domains',
    column: 'related_phrase.phrase',
    valueKind: 'number',
    placements: [
      {
        label: 'WHERE',
        target: 'where',
        kind: 'min-domains',
        specId: 'minDomains',
      },
    ],
  },
];

/**
 * The operator subset a shared facet field (`facet-multi` / `facet-multi-array`)
 * exposes in the Builder. The `condition` kind advertises the full vocabulary,
 * but a facet control only makes sense for membership + emptiness operators, so
 * the builder filters the kind's `operators` to these ids (order preserved).
 *
 * - Scalar facet columns (Domain, Device): `in`/`not_in`/`is_empty`/`is_not_empty`.
 * - Array facet columns (Keyword Group): the array operators
 *   `list_has_any`/`list_has_all`/`excludes_all`.
 */
export const FACET_SCALAR_OPERATORS = [
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
] as const;

export const FACET_ARRAY_OPERATORS = [
  'list_has_any',
  'list_has_all',
  'excludes_all',
] as const;

/** The operator ids a facet field of a given value kind is allowed to offer. */
export function facetOperatorIds(
  valueKind: FieldValueKind,
): ReadonlyArray<string> {
  return valueKind === 'facet-multi-array'
    ? FACET_ARRAY_OPERATORS
    : FACET_SCALAR_OPERATORS;
}
