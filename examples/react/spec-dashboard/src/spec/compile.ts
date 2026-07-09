/**
 * Spec loading + compilation: the runtime pipeline from raw YAML text to a
 * validated, ready-to-render {@link CompiledSpec}.
 *
 *   fetch text → YAML.parse → zod validate → build a throwaway topology (for
 *   `validNames` + structural validation) → cross-reference validate
 *
 * Every stage returns a {@link CompileResult}: either `ok` with the compiled
 * spec, or a list of human-readable errors. The editor panel shows the errors
 * WITHOUT tearing down the last good dashboard.
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { createTopology } from '@nozzleio/react-mosaic';
import { dashboardSpecSchema } from './schema';
import { buildKindRegistry, buildSpecKinds } from './kinds';
import { buildTopologyOptions, toTopologyConfig } from './topology';
import { validateCrossReferences } from './validate';
import type {
  FilterKind,
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '@nozzleio/react-mosaic';
import type { ZodError } from 'zod';
import type { DashboardSpec, WidgetSpec } from './schema';

/**
 * Normalize the parsed spec into the runtime {@link DashboardSpec}: the parse
 * shape carries `widgets` as a record of id-less values keyed by id, so inject
 * each key back onto its widget as `id` (the single boundary where the record
 * key becomes the runtime `widget.id` every downstream consumer reads). Object
 * insertion order is preserved, so the widgets keep their declaration order.
 */
function normalizeSpec(
  raw: z.infer<typeof dashboardSpecSchema>,
): DashboardSpec {
  const widgets: Record<string, WidgetSpec> = {};
  for (const [id, widget] of Object.entries(raw.widgets)) {
    widgets[id] = { ...widget, id };
  }
  return { ...raw, widgets };
}

/**
 * The manifest of available specs, served alongside them at the app origin. The
 * boot flow fetches this first, resolves the active spec id from the `?spec=`
 * URL search param (falling back to `default`), then fetches that spec's YAML.
 * All ids/labels/urls are DATA here — no domain vocabulary lives in src/.
 */
export const MANIFEST_URL = '/spec/manifest.json';

/** One selectable spec: a stable `id`, a human `label`, and its YAML `url`. */
export const specManifestEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

export const specManifestSchema = z
  .object({
    /** Id selected when the `?spec=` param is absent or names an unknown id. */
    default: z.string().min(1),
    specs: z.array(specManifestEntrySchema).min(1),
  })
  .strict();

export type SpecManifestEntry = z.infer<typeof specManifestEntrySchema>;
export type SpecManifest = z.infer<typeof specManifestSchema>;

/** A validated spec plus the stable topology inputs `useTopology` consumes. */
export interface CompiledSpec {
  spec: DashboardSpec;
  topologyConfig: TopologyConfig;
  topologyOptions: TopologyOptions;
  /** Built-ins + kinds instantiated from `filter_kinds:` (for the filter builder). */
  kindRegistry: Record<string, FilterKind>;
}

export type CompileResult =
  | { ok: true; compiled: CompiledSpec }
  | { ok: false; errors: Array<string> };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Flatten a ZodError into one message per issue (`path: message`). */
function formatZodError(error: ZodError): Array<string> {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    return `${path === '' ? '(root)' : path}: ${issue.message}`;
  });
}

/** Fetch + zod-validate the spec manifest from `url` (defaults to the served manifest). */
export async function fetchManifest(
  url: string = MANIFEST_URL,
): Promise<SpecManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `failed to fetch manifest from '${url}' (${response.status}).`,
    );
  }
  const raw: unknown = await response.json();
  const parsed = specManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid spec manifest: ${formatZodError(parsed.error).join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Resolve the manifest entry for a wanted spec id: the matching entry when
 * `wantedId` names a known id, else the `default` entry, else — defensively,
 * should `default` itself be unknown — the first entry (the schema guarantees at
 * least one). Never throws.
 */
export function resolveSpecEntry(
  manifest: SpecManifest,
  wantedId: string | null,
): SpecManifestEntry {
  const byWanted =
    wantedId === null
      ? undefined
      : manifest.specs.find((entry) => entry.id === wantedId);
  if (byWanted !== undefined) {
    return byWanted;
  }
  const byDefault = manifest.specs.find(
    (entry) => entry.id === manifest.default,
  );
  if (byDefault !== undefined) {
    return byDefault;
  }
  // `specs` is `.min(1)`, so index 0 is always present.
  return manifest.specs[0]!;
}

/** Fetch the raw spec YAML text from `url`. */
export async function fetchSpecText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch spec from '${url}' (${response.status}).`);
  }
  return response.text();
}

/**
 * Compile raw YAML text to a validated {@link CompiledSpec}, or a list of
 * errors. Pure and synchronous — safe to call outside React (the editor's Apply
 * handler, tests, a build step).
 */
export function compileSpec(text: string): CompileResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (reason) {
    return { ok: false, errors: [`YAML parse error: ${errorMessage(reason)}`] };
  }

  const parsed = dashboardSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: formatZodError(parsed.error) };
  }
  const spec = normalizeSpec(parsed.data);

  const kindRegistry = buildKindRegistry(spec);
  const topologyConfig = toTopologyConfig(spec.topology);
  const topologyOptions = buildTopologyOptions(
    spec.topology,
    buildSpecKinds(spec),
  );

  // Build a throwaway topology purely to (a) run the library's structural
  // validation (bad include/context refs throw) and (b) read `validNames`.
  // The live topology the tree renders against is built separately by
  // `useTopology` from the same (stable) config objects.
  let topology: Topology;
  try {
    topology = createTopology(topologyConfig, topologyOptions);
  } catch (reason) {
    return { ok: false, errors: [`topology error: ${errorMessage(reason)}`] };
  }
  const validNames = new Set(topology.validNames);
  topology.destroy();

  const crossRefErrors = validateCrossReferences(
    spec,
    validNames,
    kindRegistry,
  );
  if (crossRefErrors.length > 0) {
    return { ok: false, errors: crossRefErrors };
  }

  return {
    ok: true,
    compiled: { spec, topologyConfig, topologyOptions, kindRegistry },
  };
}
