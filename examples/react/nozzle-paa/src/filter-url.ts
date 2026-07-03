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
 * - `f.text:phrase=coleman`              — a `match`/contains string
 * - `f.date:requested=2024-01-01..2024-01-31` — an `interval`, ISO `lo..hi`
 * - `f.minDomains=4`                     — the `min-domains` threshold (N)
 * - `f.facet:domain=reddit.com`          — a single-select `point`
 * - `f.facet:keyword-group=a,b`          — a multi-value list (comma-joined)
 * - `f.metric:question=gt:5000`          — a metric threshold (`op:value`)
 * - `f.select:phrase=gaz stove,gasoline stove` — a row-selection points spec
 * - `f.detail:paa_question=coleman`      — a bridged detail column filter
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
import type { FilterSpec, Persister } from '@nozzleio/react-mosaic';

/** The `f.` namespace keeps our params from colliding with foreign ones. */
const PARAM_PREFIX = 'f.';

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

/** A `match`/contains text spec: the param is the raw string. */
function matchCodec(column: string, label: string): SpecCodec {
  return {
    column,
    kind: 'match',
    operator: 'contains',
    label,
    encode: (spec) =>
      typeof spec.value === 'string' && spec.value.length > 0
        ? spec.value
        : null,
    decode: (id, raw) =>
      raw.length === 0
        ? null
        : {
            id,
            column,
            kind: 'match',
            operator: 'contains',
            value: raw,
            label,
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

/** A single-select facet `point`: the param is the scalar value. */
function pointCodec(column: string, label: string): SpecCodec {
  return {
    column,
    kind: 'point',
    label,
    encode: (spec) =>
      typeof spec.value === 'string' || typeof spec.value === 'number'
        ? String(spec.value)
        : null,
    decode: (id, raw) =>
      raw.length === 0
        ? null
        : { id, column, kind: 'point', value: raw, label },
  };
}

/**
 * A multi-value list spec (`points`/`condition`): the param is the values,
 * each URL-encoded, comma-joined. `kind`/`operator` come from the config.
 */
function listCodec(config: {
  column: string;
  kind: string;
  operator?: string;
  label: string;
}): SpecCodec {
  return {
    column: config.column,
    kind: config.kind,
    operator: config.operator,
    label: config.label,
    encode: (spec) => {
      if (!Array.isArray(spec.value) || spec.value.length === 0) {
        return null;
      }
      return spec.value
        .map((value) => encodeURIComponent(String(value)))
        .join(',');
    },
    decode: (id, raw) => {
      const values = decodeList(raw);
      if (values.length === 0) {
        return null;
      }
      const spec: FilterSpec = {
        id,
        column: config.column,
        kind: config.kind,
        value: values,
        label: config.label,
      };
      if (config.operator !== undefined) {
        spec.operator = config.operator;
      }
      return spec;
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

/**
 * Static config for every known spec id or id family (`<prefix>:*`). Ids with a
 * `:` are matched by their prefix (metric/select/detail/facet); the rest match
 * exactly. Facet ids are enumerated because their kinds differ per column.
 */
const EXACT_CODECS: Record<string, SpecCodec> = {
  'text:phrase': matchCodec('phrase', 'Keyword'),
  'text:desc': matchCodec('description', 'Answer Text'),
  'text:question': matchCodec('related_phrase.phrase', 'Question'),
  'date:requested': dateCodec,
  minDomains: minDomainsCodec,
  'facet:domain': pointCodec('domain', 'Domain'),
  'facet:device': pointCodec('device', 'Device'),
  'facet:keyword-group': listCodec({
    column: 'keyword_groups',
    kind: 'condition',
    operator: 'list_has_any',
    label: 'Keyword Group',
  }),
};

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

/** Resolves the codec for a spec id, or `null` when the id is unknown. */
function codecFor(id: string): SpecCodec | null {
  const exact = EXACT_CODECS[id];
  if (exact !== undefined) {
    return exact;
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
    // Detail specs are `match`/contains, keyed `detail:<tanstack-column-id>`.
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
              id: specId,
              column,
              kind: 'match',
              operator: 'contains',
              value: raw,
              label,
            },
    };
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
