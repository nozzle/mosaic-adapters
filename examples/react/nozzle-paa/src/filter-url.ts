/**
 * A consumer-owned URL {@link Persister} for the page {@link filterSet}.
 *
 * The whole dashboard state — top-bar text/date/min-domains, facet picks,
 * summary row selections, per-card metric thresholds, and detail column
 * filters — round-trips through `location.search`, so any filtered view is a
 * shareable link.
 *
 * ## What is encoded
 *
 * One search param per active spec, prefixed `f.` and keyed by the spec id
 * (`f.<spec.id>`). Untouched filters have no param; foreign params (anything
 * not prefixed `f.`) are preserved across writes. The value half is
 * human-readable where it is cheap to be:
 *
 * - `f.text:phrase=coleman`              — a `condition`/contains string
 * - `f.date:requested=2024-01-01..2024-01-31` — an `interval`, ISO `lo..hi`
 * - `f.minDomains=4`                     — the `min-domains` threshold (N)
 * - `f.facet:domain=reddit.com`          — a `condition`/`in` list (comma-joined)
 * - `f.facet:keyword-group=a,b`          — a multi-value list (comma-joined)
 * - `f.metric:question=gt:5000`          — a metric threshold (`op:value`)
 * - `f.built:search-volume=gt:5000`      — a per-row `condition` (`op:value`,
 *   or `op:lo:hi` for `between`) on the search_volume column
 * - `f.select:phrase=gaz stove,gasoline stove` — a row-selection points spec
 * - `f.detail:paa_question=coleman`      — a bridged detail column filter
 *
 * ## The non-default-operator envelope (`op~`)
 *
 * A `condition` field's DEFAULT operator (the value-bearing `in`/`list_has_any`
 * for facets, `contains` for text) encodes as the bare value(s) above, so the
 * common case stays pretty and existing shared links keep working. A NON-default
 * operator (e.g. `not_in`, `list_has_all`, `starts_with`, or the valueless
 * `is_empty`/`is_not_empty`) is carried in an unambiguous envelope:
 *
 * - `f.facet:domain=op~not_in~reddit.com,foo.com` — an operator marker, then the
 *   normal value serialization (the values are always %-encoded, so a real value
 *   can never begin the `op~<operator>~` sentinel).
 * - `f.facet:domain=op~is_empty~`                 — a valueless spec: the marker
 *   with an empty value tail.
 *
 * On read the operator is validated against the kind's allowed set; garbage (or
 * an unknown operator) falls back to the config default, exactly as the "the set
 * validates again and drops anything malformed" posture below. A legacy bare
 * value always decodes to the default operator.
 *
 * ## Legacy read-side aliases
 *
 * `f.text:desc=<q>` (a dropped legacy Answer-Text control) decodes to the
 * canonical `detail:description` spec, so old shared links keep filtering; the
 * write side then re-emits the value under the canonical `detail:description`
 * param.
 *
 * ## The codec is declarative
 *
 * {@link SPEC_CONFIG} maps every known spec id (or `<prefix>:*` family) to the
 * static parts of its {@link FilterSpec} — column, kind, fixed operator, label,
 * target. The URL param carries only the dynamic parts (the value, and the
 * operator where it varies). On read we look the config up, reconstruct the
 * full spec, and hand it to the set; the set validates again and drops anything
 * malformed. Unknown params and unparseable values are skipped defensively.
 *
 * ## Reason → history entry
 *
 * This example is router-less by design, so `write` always uses
 * `history.replaceState` — every reason edits the current entry rather than
 * pushing a new one. A real app should map `reason` to its router instead
 * (`'update'` → push, `'external'`/`'clear'` → replace, roughly), and — better
 * still — drive the filter setters *from* the router's reactive search params
 * so browser back/forward works. See `docs/react/router-persistence.md`.
 */
import {
  FACET_ARRAY_OPERATORS,
  FACET_SCALAR_OPERATORS,
  FILTER_CATALOG,
} from './filter-catalog';
import type { FilterSpec, Persister } from '@nozzleio/react-mosaic';

/** The `f.` namespace keeps our params from colliding with foreign ones. */
const PARAM_PREFIX = 'f.';

/**
 * The sentinel that marks a non-default operator in a `condition` param value.
 * `op~<operator>~<value-tail>`. The value tail is the same serialization the
 * default case uses; because every list element and scalar value is %-encoded,
 * a real value can never legitimately begin `op~<operator>~`.
 */
const OPERATOR_ENVELOPE = /^op~([a-z_]+)~/;

/**
 * Wraps a serialized value tail in the operator envelope. `valueTail` may be
 * empty for a valueless (arity `none`) operator like `is_empty`.
 */
function encodeOperatorEnvelope(operator: string, valueTail: string): string {
  return `op~${operator}~${valueTail}`;
}

/**
 * Splits a `condition` param value into its operator (or `null` for the bare,
 * default-operator form) and the remaining value tail.
 */
function parseOperatorEnvelope(raw: string): {
  operator: string | null;
  valueTail: string;
} {
  const match = OPERATOR_ENVELOPE.exec(raw);
  if (match === null) {
    return { operator: null, valueTail: raw };
  }
  return { operator: match[1] ?? null, valueTail: raw.slice(match[0].length) };
}

/** Text operators that carry no value tail (arity `none`). */
const VALUELESS_TEXT_OPERATORS = new Set([
  'is_empty',
  'is_not_empty',
  'is_null',
  'not_null',
]);

/**
 * The static parts of a spec, plus a per-family value codec. The URL param
 * carries only what `encode`/`decode` move; everything else is reconstructed
 * from here on read.
 */
interface SpecCodec {
  /** Fixed {@link FilterSpec.column}. */
  column: string;
  /** Fixed {@link FilterSpec.kind}. */
  kind: string;
  /** Fixed {@link FilterSpec.operator}, when the kind pins one. */
  operator?: string;
  /** Fixed {@link FilterSpec.label} (chip parity). */
  label: string;
  /** Fixed {@link FilterSpec.target}, when non-default. */
  target?: string;
  /**
   * Serializes a spec's dynamic parts to the param value, or `null` when the
   * spec is inactive/empty (its param is then omitted).
   */
  encode: (spec: FilterSpec) => string | null;
  /**
   * Rebuilds a spec (given its id) from the param value, or `null` when the
   * value is malformed (the param is then skipped).
   */
  decode: (id: string, raw: string) => FilterSpec | null;
}

// ── Per-family value codecs ──────────────────────────────────────────────────

/**
 * The `condition` text operators the Builder text fields can author (mirrors the
 * core `conditionFilterKind` vocabulary, unary/valueless entries only — a text
 * input has no `set`/`range` control). `contains` is the default (bare form).
 */
const TEXT_OPERATORS = new Set([
  'contains',
  'not_contains',
  'starts_with',
  'not_starts_with',
  'ends_with',
  'not_ends_with',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
  'is_null',
  'not_null',
]);

/**
 * A `condition` text spec. The classic Phrase/Question controls and the Builder
 * text fields both author `condition` (not `match`), so the two views converge
 * on one spec shape. The default `contains` operator encodes as the bare raw
 * string (back-compat, pretty URLs); any other Builder operator round-trips
 * through the {@link OPERATOR_ENVELOPE} (`op~starts_with~coleman`), including the
 * valueless `is_empty`/`is_not_empty` (`op~is_empty~`). A legacy bare value
 * always decodes to `contains`.
 */
function conditionTextCodec(column: string, label: string): SpecCodec {
  return {
    column,
    kind: 'condition',
    operator: 'contains',
    label,
    encode: (spec) => {
      const operator =
        typeof spec.operator === 'string' ? spec.operator : 'contains';
      if (!TEXT_OPERATORS.has(operator)) {
        return null;
      }
      if (VALUELESS_TEXT_OPERATORS.has(operator)) {
        return encodeOperatorEnvelope(operator, '');
      }
      if (typeof spec.value !== 'string' || spec.value.length === 0) {
        return null;
      }
      if (operator === 'contains') {
        return spec.value;
      }
      return encodeOperatorEnvelope(operator, spec.value);
    },
    decode: (id, raw) => {
      const { operator, valueTail } = parseOperatorEnvelope(raw);
      // Bare form (legacy + default): a non-empty contains value.
      if (operator === null) {
        return valueTail.length === 0
          ? null
          : {
              id,
              column,
              kind: 'condition',
              operator: 'contains',
              value: valueTail,
              label,
            };
      }
      // Enveloped operator: validate, else fall back to the bare interpretation.
      if (!TEXT_OPERATORS.has(operator)) {
        return raw.length === 0
          ? null
          : {
              id,
              column,
              kind: 'condition',
              operator: 'contains',
              value: raw,
              label,
            };
      }
      if (VALUELESS_TEXT_OPERATORS.has(operator)) {
        return { id, column, kind: 'condition', operator, label };
      }
      return valueTail.length === 0
        ? null
        : {
            id,
            column,
            kind: 'condition',
            operator,
            value: valueTail,
            label,
          };
    },
  };
}

/** An ISO date `interval`: the param is `lo..hi` (either bound may be empty). */
const dateCodec: SpecCodec = {
  column: 'requested',
  kind: 'interval',
  label: 'Date Range',
  encode: (spec) => {
    const bounds = Array.isArray(spec.value) ? spec.value : [null, null];
    const lo = typeof bounds[0] === 'string' ? bounds[0] : '';
    const hi = typeof bounds[1] === 'string' ? bounds[1] : '';
    if (lo === '' && hi === '') {
      return null;
    }
    return `${lo}..${hi}`;
  },
  decode: (id, raw) => {
    const separator = raw.indexOf('..');
    if (separator < 0) {
      return null;
    }
    const lo = raw.slice(0, separator);
    const hi = raw.slice(separator + 2);
    if (lo === '' && hi === '') {
      return null;
    }
    return {
      id,
      column: 'requested',
      kind: 'interval',
      value: [lo === '' ? null : lo, hi === '' ? null : hi],
      label: 'Date Range',
    };
  },
};

/** The `min-domains` threshold: the param is the bare integer N. */
const minDomainsCodec: SpecCodec = {
  column: 'related_phrase.phrase',
  kind: 'min-domains',
  operator: 'gte',
  label: 'Min Domains',
  encode: (spec) => {
    const n = Number(spec.value);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  },
  decode: (id, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    return {
      id,
      column: 'related_phrase.phrase',
      kind: 'min-domains',
      operator: 'gte',
      value: n,
      label: 'Min Domains',
    };
  },
};

/**
 * A multi-value list spec (`points`/`condition`): the param is the values, each
 * URL-encoded, comma-joined. `kind`/`operator` come from the config.
 *
 * For a `condition` facet the Builder can author a non-default operator
 * (`not_in`, `list_has_all`, `excludes_all`, or the valueless
 * `is_empty`/`is_not_empty`). `allowedOperators` names the vocabulary that
 * placement offers, with `config.operator` the default. The default operator
 * encodes as the bare comma-joined list (back-compat, pretty URLs); any other
 * goes through the {@link OPERATOR_ENVELOPE}. On read an operator failing
 * validation falls back to `config.operator`.
 */
function listCodec(config: {
  column: string;
  kind: string;
  operator?: string;
  label: string;
  allowedOperators?: ReadonlyArray<string>;
  valuelessOperators?: ReadonlyArray<string>;
}): SpecCodec {
  const allowed = new Set(config.allowedOperators ?? []);
  const valueless = new Set(config.valuelessOperators ?? []);

  const buildSpec = (
    id: string,
    operator: string | undefined,
    values: Array<string>,
  ): FilterSpec => {
    const spec: FilterSpec = {
      id,
      column: config.column,
      kind: config.kind,
      value: values,
      label: config.label,
    };
    if (operator !== undefined) {
      spec.operator = operator;
    }
    return spec;
  };

  const buildValueless = (id: string, operator: string): FilterSpec => ({
    id,
    column: config.column,
    kind: config.kind,
    operator,
    label: config.label,
  });

  const encodeList = (spec: FilterSpec): string =>
    Array.isArray(spec.value)
      ? spec.value.map((value) => encodeURIComponent(String(value))).join(',')
      : '';

  return {
    column: config.column,
    kind: config.kind,
    operator: config.operator,
    label: config.label,
    encode: (spec) => {
      const operator =
        typeof spec.operator === 'string' ? spec.operator : config.operator;
      // A valueless operator carries no list; encode as an empty envelope.
      if (operator !== undefined && valueless.has(operator)) {
        return encodeOperatorEnvelope(operator, '');
      }
      if (!Array.isArray(spec.value) || spec.value.length === 0) {
        return null;
      }
      const list = encodeList(spec);
      // The config default stays bare; every other allowed operator is wrapped.
      if (operator === undefined || operator === config.operator) {
        return list;
      }
      if (!allowed.has(operator)) {
        return null;
      }
      return encodeOperatorEnvelope(operator, list);
    },
    decode: (id, raw) => {
      const { operator, valueTail } = parseOperatorEnvelope(raw);
      // Bare form (legacy + default operator): a non-empty value list.
      if (operator === null) {
        const values = decodeList(valueTail);
        return values.length === 0
          ? null
          : buildSpec(id, config.operator, values);
      }
      // Unknown/garbage operator: fall back to the default, treating the whole
      // raw param as a bare value list (consistent with the drop-malformed rule).
      if (!allowed.has(operator)) {
        const values = decodeList(raw);
        return values.length === 0
          ? null
          : buildSpec(id, config.operator, values);
      }
      if (valueless.has(operator)) {
        return buildValueless(id, operator);
      }
      const values = decodeList(valueTail);
      return values.length === 0 ? null : buildSpec(id, operator, values);
    },
  };
}

/** A metric threshold: the param is `op:value` (e.g. `gt:5000`). */
function metricCodec(label: string, column: string): SpecCodec {
  return {
    column,
    kind: 'metric-threshold',
    label,
    encode: (spec) => {
      const op = spec.operator === 'lt' ? 'lt' : 'gt';
      const n = Number(spec.value);
      return Number.isFinite(n) && n >= 0 ? `${op}:${n}` : null;
    },
    decode: (id, raw) => {
      const parsed = parseOperatorValue(raw);
      if (parsed === null) {
        return null;
      }
      const op = parsed.operator === 'lt' ? 'lt' : 'gt';
      const n = Number(parsed.value);
      if (!Number.isFinite(n) || n < 0) {
        return null;
      }
      return {
        id,
        column,
        kind: 'metric-threshold',
        operator: op,
        value: n,
        label,
      };
    },
  };
}

/**
 * A summary row-selection `points` spec. The rows client's single-field
 * `publish.select` (all four PAA cards select on one field) publishes a FLAT
 * scalar array as the spec value, with `column` set to the real group-by
 * field — the `{ columns, tuples }` envelope shape only appears for
 * multi-field selects. The param is the scalars, URL-encoded and comma-joined.
 * All four select fields are string-typed columns, so the `String()`
 * round-trip is lossless.
 */
function selectCodec(column: string, label: string): SpecCodec {
  return {
    column,
    kind: 'points',
    label,
    encode: (spec) => {
      // The flat array is the real single-field shape; tolerate an envelope
      // defensively by taking each tuple's first element.
      const values = Array.isArray(spec.value)
        ? spec.value
        : isEnvelope(spec.value)
          ? spec.value.tuples.map((tuple) => tuple[0])
          : null;
      if (values === null || values.length === 0) {
        return null;
      }
      return values.map((value) => encodeURIComponent(String(value))).join(',');
    },
    decode: (id, raw) => {
      const values = decodeList(raw);
      if (values.length === 0) {
        return null;
      }
      return { id, column, kind: 'points', value: values, label };
    },
  };
}

interface Envelope {
  columns: Array<string>;
  tuples: Array<Array<unknown>>;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Envelope).columns) &&
    Array.isArray((value as Envelope).tuples)
  );
}

// ── The declarative spec table ────────────────────────────────────────────────

/** The facet scalar operators that carry no value list (arity `none`). */
const FACET_VALUELESS_OPERATORS = ['is_empty', 'is_not_empty'] as const;

/**
 * Static config for every known spec id or id family (`<prefix>:*`). Ids with a
 * `:` are matched by their prefix (metric/select/detail/facet); the rest match
 * exactly. Facet ids are enumerated because their kinds differ per column.
 */
const EXACT_CODECS: Record<string, SpecCodec> = {
  // The classic Phrase/Question controls and the Builder text fields author
  // `condition`/contains (shared spec ids), so these persist as condition specs.
  'text:phrase': conditionTextCodec('phrase', 'Phrase'),
  'text:question': conditionTextCodec('related_phrase.phrase', 'Question'),
  'date:requested': dateCodec,
  minDomains: minDomainsCodec,
  // Domain/Device are now multi-select `condition`/`in` list specs (shared with
  // the Builder facet fields), so a single-value URL like `facet:domain=x`
  // hydrates to a one-element `in` list — the governing "Classic never limits
  // Builder" refactor.
  'facet:domain': listCodec({
    column: 'domain',
    kind: 'condition',
    operator: 'in',
    label: 'Domain',
    allowedOperators: FACET_SCALAR_OPERATORS,
    valuelessOperators: FACET_VALUELESS_OPERATORS,
  }),
  'facet:device': listCodec({
    column: 'device',
    kind: 'condition',
    operator: 'in',
    label: 'Device',
    allowedOperators: FACET_SCALAR_OPERATORS,
    valuelessOperators: FACET_VALUELESS_OPERATORS,
  }),
  'facet:keyword-group': listCodec({
    column: 'keyword_groups',
    kind: 'condition',
    operator: 'list_has_any',
    label: 'Keyword Group',
    allowedOperators: FACET_ARRAY_OPERATORS,
  }),
  // The Builder's Search Volume "per row (WHERE)" placement (filter-catalog.ts)
  // writes a numeric `condition` spec on the search_volume column. Data-driven
  // from the catalog so its id/column/label stay in one place.
  'built:search-volume': builtSearchVolumeCodec(),
};

/**
 * Static config for the `built:search-volume` codec, resolved from the catalog's
 * Search Volume field + its WHERE placement (so column/label never drift).
 */
function searchVolumeWhereConfig(): { column: string; label: string } {
  const field = FILTER_CATALOG.find((entry) => entry.id === 'search-volume');
  const placement = field?.placements.find(
    (entry) => entry.specId === 'built:search-volume',
  );
  return {
    column: placement?.specColumn ?? field?.column ?? 'search_volume',
    label: field?.label ?? 'Search Volume',
  };
}

/**
 * The Builder's per-row Search Volume filter: a numeric `condition` spec. The
 * param is `op:value` (e.g. `gt:5000`), `op:lo:hi` for the `between` range, or a
 * bare `op:` tail for the valueless emptiness operators. Unknown operators or
 * unparseable numbers are dropped defensively.
 */
function builtSearchVolumeCodec(): SpecCodec {
  const { column, label } = searchVolumeWhereConfig();
  const kind = 'condition';
  const toNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return null;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  return {
    column,
    kind,
    label,
    encode: (spec) => {
      const operator = typeof spec.operator === 'string' ? spec.operator : '';
      if (!SEARCH_VOLUME_OPERATORS.has(operator)) {
        return null;
      }
      if (SEARCH_VOLUME_VALUELESS.has(operator)) {
        return `${operator}:`;
      }
      const value = Number(spec.value);
      if (!Number.isFinite(value)) {
        return null;
      }
      if (operator === 'between') {
        const valueTo = Number(spec.valueTo);
        if (!Number.isFinite(valueTo)) {
          return null;
        }
        return `${operator}:${value}:${valueTo}`;
      }
      return `${operator}:${value}`;
    },
    decode: (id, raw) => {
      const parsed = parseOperatorValue(raw);
      if (parsed === null || !SEARCH_VOLUME_OPERATORS.has(parsed.operator)) {
        return null;
      }
      const operator = parsed.operator;
      if (SEARCH_VOLUME_VALUELESS.has(operator)) {
        return { id, column, kind, operator, label };
      }
      if (operator === 'between') {
        const separator = parsed.value.indexOf(':');
        if (separator < 0) {
          return null;
        }
        const lo = toNumber(parsed.value.slice(0, separator));
        const hi = toNumber(parsed.value.slice(separator + 1));
        if (lo === null || hi === null) {
          return null;
        }
        return { id, column, kind, operator, value: lo, valueTo: hi, label };
      }
      const value = toNumber(parsed.value);
      if (value === null) {
        return null;
      }
      return { id, column, kind, operator, value, label };
    },
  };
}

/** The numeric `condition` operators the Search Volume WHERE placement offers. */
const SEARCH_VOLUME_OPERATORS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_null',
  'not_null',
  'is_empty',
  'is_not_empty',
]);

/** Search Volume operators that carry no value (arity `none`). */
const SEARCH_VOLUME_VALUELESS = new Set([
  'is_null',
  'not_null',
  'is_empty',
  'is_not_empty',
]);

/** Per-summary-card metric group-by columns and chip labels. */
const METRIC_CARDS: Record<string, { column: string; label: string }> = {
  phrase: { column: 'phrase', label: 'Search Vol' },
  question: { column: 'related_phrase.phrase', label: 'SERP Appears' },
  domain: { column: 'domain', label: 'Domain Answers' },
  url: { column: 'url', label: 'URL Answers' },
};

/** Per-summary-card row-selection fields and chip labels (summary-table.tsx). */
const SELECT_CARDS: Record<string, { column: string; label: string }> = {
  phrase: { column: 'phrase', label: 'Selected Keyword' },
  question: { column: 'related_phrase.phrase', label: 'Selected Question' },
  domain: { column: 'domain', label: 'Selected Domain' },
  url: { column: 'url', label: 'Selected URL' },
};

/** Detail column chip labels (parity with the bridge column config). */
const DETAIL_LABELS: Record<string, string> = {
  domain: 'Domain',
  paa_question: 'PAA Question',
  title: 'Answer Title',
  description: 'Answer Description',
};

/** Detail spec column → SQL column (paa_question maps onto the struct path). */
const DETAIL_COLUMNS: Record<string, string> = {
  domain: 'domain',
  paa_question: 'related_phrase.phrase',
  title: 'title',
  description: 'description',
};

/**
 * A detail column filter: a `match`/contains spec keyed `detail:<column-id>`.
 * `emitId`, when given, overrides the spec id the codec decodes to (so a legacy
 * alias can hydrate the canonical detail spec regardless of the param key it was
 * read under).
 */
function detailCodec(
  column: string,
  label: string,
  emitId?: string,
): SpecCodec {
  return {
    column,
    kind: 'match',
    operator: 'contains',
    label,
    encode: (spec) =>
      typeof spec.value === 'string' && spec.value.length > 0
        ? spec.value
        : null,
    decode: (specId, raw) =>
      raw.length === 0
        ? null
        : {
            id: emitId ?? specId,
            column,
            kind: 'match',
            operator: 'contains',
            value: raw,
            label,
          },
  };
}

/**
 * Read-side legacy aliases: an old param key → the codec that hydrates its
 * modern equivalent. `text:desc` was the dropped Answer-Text control; it now
 * lives as the detail table's `detail:description` column filter, so an old
 * shared link (`?f.text:desc=coleman`) decodes to that canonical spec, which the
 * write side then re-emits under `f.detail:description`.
 */
const LEGACY_ALIASES: Record<string, SpecCodec> = {
  'text:desc': detailCodec(
    DETAIL_COLUMNS.description ?? 'description',
    DETAIL_LABELS.description ?? 'Answer Description',
    'detail:description',
  ),
};

/** Resolves the codec for a spec id, or `null` when the id is unknown. */
function codecFor(id: string): SpecCodec | null {
  const exact = EXACT_CODECS[id];
  if (exact !== undefined) {
    return exact;
  }
  const alias = LEGACY_ALIASES[id];
  if (alias !== undefined) {
    return alias;
  }
  const colon = id.indexOf(':');
  if (colon < 0) {
    return null;
  }
  const prefix = id.slice(0, colon);
  const suffix = id.slice(colon + 1);
  if (prefix === 'metric') {
    const card = METRIC_CARDS[suffix];
    return card === undefined ? null : metricCodec(card.label, card.column);
  }
  if (prefix === 'select') {
    const card = SELECT_CARDS[suffix];
    return card === undefined ? null : selectCodec(card.column, card.label);
  }
  if (prefix === 'detail') {
    const label = DETAIL_LABELS[suffix];
    const column = DETAIL_COLUMNS[suffix];
    if (label === undefined || column === undefined) {
      return null;
    }
    return detailCodec(column, label);
  }
  return null;
}

// ── Small parse helpers ───────────────────────────────────────────────────────

/** Splits a comma-joined, per-element URL-encoded list, dropping empties. */
function decodeList(raw: string): Array<string> {
  if (raw.length === 0) {
    return [];
  }
  const values: Array<string> = [];
  for (const part of raw.split(',')) {
    if (part.length === 0) {
      continue;
    }
    try {
      values.push(decodeURIComponent(part));
    } catch {
      // A malformed %-escape: skip that element, keep the rest.
    }
  }
  return values;
}

/** Parses an `operator:value` param (e.g. `gt:5000`), or `null`. */
function parseOperatorValue(
  raw: string,
): { operator: string; value: string } | null {
  const separator = raw.indexOf(':');
  if (separator < 0) {
    return null;
  }
  return {
    operator: raw.slice(0, separator),
    value: raw.slice(separator + 1),
  };
}

// ── The persister ─────────────────────────────────────────────────────────────

/**
 * Reads/writes the whole `FilterSpec[]` in `location.search`, one `f.` param
 * per spec. Guarded for non-browser environments (SSR/vitest) so importing the
 * page context never touches an undefined `window`.
 */
export const urlPersister: Persister<Array<FilterSpec>> = {
  read: () => {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const specs: Array<FilterSpec> = [];
    for (const [key, raw] of params) {
      if (!key.startsWith(PARAM_PREFIX)) {
        continue;
      }
      const id = key.slice(PARAM_PREFIX.length);
      const codec = codecFor(id);
      if (codec === null) {
        continue;
      }
      const spec = codec.decode(id, raw);
      if (spec !== null) {
        specs.push(spec);
      }
    }
    return specs.length === 0 ? null : specs;
  },

  write: (specs) => {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);

    // Drop every existing `f.` param; foreign params are preserved untouched.
    for (const key of [...params.keys()]) {
      if (key.startsWith(PARAM_PREFIX)) {
        params.delete(key);
      }
    }

    // Re-add one param per active spec. `null` (clear/empty) leaves none.
    if (specs !== null) {
      for (const spec of specs) {
        const codec = codecFor(spec.id);
        if (codec === null) {
          continue;
        }
        const value = codec.encode(spec);
        if (value === null) {
          continue;
        }
        params.set(`${PARAM_PREFIX}${spec.id}`, value);
      }
    }

    const query = params.toString();
    const next = `${window.location.pathname}${query === '' ? '' : `?${query}`}${window.location.hash}`;
    // Router-less example: every reason replaces the current history entry.
    // A real app maps reason → push/replace via its router — and, better,
    // drives the setters from the router's reactive search. See
    // docs/react/router-persistence.md.
    window.history.replaceState(window.history.state, '', next);
  },
};
