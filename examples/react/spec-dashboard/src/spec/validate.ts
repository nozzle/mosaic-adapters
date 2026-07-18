/**
 * Cross-reference validation — the checks zod cannot express because they span
 * sections of the spec (or reference code-side registries and the constructed
 * topology's `validNames`). Runs AFTER zod parsing and AFTER the topology is
 * built, and reports EVERY violation together (never first-failure) so a spec
 * author fixes them in one pass.
 *
 * Checks:
 * - every widget `renderer` exists in the component registry;
 * - every `filter_by` / `having_by` ref, every vgplot mark `data.filter_by`, and
 *   every vgplot `selects[].as` is in `topology.validNames`;
 * - every kpi-card `format` is in the formatter registry;
 * - every `filter_kinds` entry names a known behavior, and its `having_target` /
 *   `members_target` resolve under a declared `filter-set` entry;
 * - every table referenced by `filter_kinds`, vgplot marks, and sparklines
 *   exists in `data.tables`;
 * - every filter placement `kind` is in the kind registry, and its `target`
 *   resolves under a declared `filter-set` entry;
 * - every `metric_threshold.kind` is in the kind registry;
 * - every widget / plot-mark `exclude` has a `filter_by` to exclude from, names
 *   only declared filter spec ids (list form), and — on a vgplot mark — uses
 *   only the `'all'` form (a native mark cannot apply a partial `skipSources`);
 * - every layout `ref` names a declared widget.
 */
import { formatterRegistry } from '../widgets/formatters';
import { widgetRegistry } from '../widgets/registry';
import { parseVariableRef } from './query-compiler';
import { isKnownBehavior } from './kinds';
import { filterSetEntryNames } from './topology';
import type { FilterKind } from '@nozzleio/react-mosaic';
import type {
  ChannelSpec,
  DashboardSpec,
  ExcludeSpec,
  StructuredQuery,
  WidgetSpec,
} from './schema';

/**
 * Validate a `$name` variable ref found in a binding position: it must name a
 * declared VARIABLE. A ref that resolves to a Selection (a `validName` that is
 * not a variable) is rejected with a precise message; anything else is an unknown
 * variable. Mirrors {@link requireVariableName} for the `$name` sites.
 */
function validateVariableRef(
  name: string,
  site: string,
  widgetId: string,
  validNames: Set<string>,
  variableNames: Set<string>,
  errors: Array<string>,
): void {
  if (variableNames.has(name)) {
    return;
  }
  if (validNames.has(name)) {
    errors.push(
      `widget '${widgetId}' ${site} references '$${name}', which is a topology selection, not a variable.`,
    );
    return;
  }
  errors.push(
    `widget '${widgetId}' ${site} references '$${name}', which is not a declared variable.`,
  );
}

/**
 * Validate the variable refs in one vgplot channel. A bare-string channel that
 * is a `$name` ref is a supported binding position (validated as a variable
 * ref). A `$name` inside a `bin` / `date_bin` / aggregate `column` sub-position
 * is NOT supported (the encoding takes a literal column) and is rejected with
 * guidance. Constants and non-ref strings are ignored.
 */
function validateChannelVariables(
  channel: ChannelSpec | undefined,
  site: string,
  widgetId: string,
  validNames: Set<string>,
  variableNames: Set<string>,
  errors: Array<string>,
): void {
  if (channel === undefined || typeof channel === 'number') {
    return;
  }
  if (typeof channel === 'string') {
    const name = parseVariableRef(channel);
    if (name !== null) {
      validateVariableRef(
        name,
        site,
        widgetId,
        validNames,
        variableNames,
        errors,
      );
    }
    return;
  }
  // A field-encoding object: the inner column is a literal position — a `$name`
  // there is an unsupported binding, flagged so it never silently mis-binds.
  const innerColumn =
    'bin' in channel
      ? channel.bin
      : 'date_bin' in channel
        ? channel.date_bin
        : channel.column;
  if (innerColumn !== undefined && parseVariableRef(innerColumn) !== null) {
    errors.push(
      `widget '${widgetId}' ${site} references a variable inside a bin/date_bin/aggregate column, which is not supported; bind a variable in a bare channel (e.g. x: $var) instead.`,
    );
  }
}

/**
 * Validate the `$name` variable refs in a structured (`type: select`) query. A
 * bare `$name` select expression binds a declared variable (compiled to a
 * `column(param)`); each ref must name a declared variable, not a selection. The
 * kpi-card, selection-table, and data-table renderers all share this check.
 */
function validateStructuredQueryVariables(
  query: StructuredQuery,
  widgetId: string,
  validNames: Set<string>,
  variableNames: Set<string>,
  errors: Array<string>,
): void {
  for (const [alias, expr] of Object.entries(query.select)) {
    const name = parseVariableRef(expr);
    if (name !== null) {
      validateVariableRef(
        name,
        `query.select '${alias}'`,
        widgetId,
        validNames,
        variableNames,
        errors,
      );
    }
  }
}

/**
 * Check a topology ref resolves to a SELECTION, recording an error if not.
 *
 * `validNames` conflates selections and variables (a topology-owned Mosaic Param
 * is a resolvable name too), so a bare variable name is rejected explicitly
 * here: the `filter_by` / `having_by` / `as` sites all consume Selections, and a
 * variable is not one.
 */
function requireValidName(
  ref: string | undefined,
  role: string,
  widgetId: string,
  validNames: Set<string>,
  variableNames: Set<string>,
  errors: Array<string>,
): void {
  if (ref === undefined) {
    return;
  }
  if (variableNames.has(ref)) {
    errors.push(
      `widget '${widgetId}' ${role} '${ref}' is a variable, not a topology selection ref.`,
    );
    return;
  }
  if (!validNames.has(ref)) {
    errors.push(
      `widget '${widgetId}' ${role} '${ref}' is not a topology selection ref.`,
    );
  }
}

/**
 * Check a ref names a declared VARIABLE (a topology-owned Mosaic Param),
 * recording an error if not — the inverse of {@link requireValidName}.
 *
 * `variableNames` is the authoritative set of declared variable names. A ref that
 * is a `validName` but not a variable is a Selection used where a variable is
 * expected (rejected with that precise message); anything else is an unknown
 * name. `variable-select`'s `variable` field is required, so `ref` is always a
 * string here.
 */
function requireVariableName(
  ref: string,
  widgetId: string,
  validNames: Set<string>,
  variableNames: Set<string>,
  errors: Array<string>,
): void {
  if (variableNames.has(ref)) {
    return;
  }
  if (validNames.has(ref)) {
    errors.push(
      `widget '${widgetId}' variable '${ref}' is a topology selection, not a variable.`,
    );
    return;
  }
  errors.push(
    `widget '${widgetId}' variable '${ref}' is not a declared variable.`,
  );
}

/** Check a referenced table exists in `data.tables`. */
function requireTable(
  table: string,
  role: string,
  widgetId: string,
  tables: Set<string>,
  errors: Array<string>,
): void {
  if (!tables.has(table)) {
    errors.push(
      `widget '${widgetId}' ${role} references table '${table}', which is not declared in data.tables.`,
    );
  }
}

/**
 * Validate an `exclude` field (widget-level or on a plot mark). It requires a
 * `filter_by` (nothing to exclude from otherwise); its list ids must all be
 * declared filter spec ids; and on a vgplot mark only the `'all'` form is
 * supported — a native vgplot mark resolves its `filterBy` Selection wholesale,
 * so it cannot apply a per-clause `skipSources`, and a list exclusion is
 * rejected with guidance.
 */
function validateExclude(options: {
  widgetId: string;
  /** Empty for a widget-level `exclude`, or a `plot mark '<mark>' ` prefix. */
  site: string;
  exclude: ExcludeSpec | undefined;
  filterByPresent: boolean;
  vgplotMark: boolean;
  filterSpecIds: Set<string>;
  errors: Array<string>;
}): void {
  const {
    widgetId,
    site,
    exclude,
    filterByPresent,
    vgplotMark,
    filterSpecIds,
  } = options;
  const { errors } = options;
  if (exclude === undefined) {
    return;
  }
  if (!filterByPresent) {
    errors.push(
      `widget '${widgetId}' ${site}declares an 'exclude' but no 'filter_by' — there is nothing to exclude from.`,
    );
    return;
  }
  if (exclude === 'all') {
    return;
  }
  if (vgplotMark) {
    errors.push(
      `widget '${widgetId}' ${site}uses a list 'exclude', which a vgplot mark cannot apply (its native filterBy resolves wholesale); use 'exclude: all', or a table renderer for a partial exclusion.`,
    );
    return;
  }
  for (const id of exclude) {
    if (!filterSpecIds.has(id)) {
      errors.push(
        `widget '${widgetId}' ${site}exclude id '${id}' is not a declared filter spec id.`,
      );
    }
  }
}

function validateWidget(
  widget: WidgetSpec,
  validNames: Set<string>,
  variableNames: Set<string>,
  tables: Set<string>,
  kindRegistry: Record<string, FilterKind>,
  filterSpecIds: Set<string>,
  errors: Array<string>,
): void {
  if (!(widget.renderer in widgetRegistry)) {
    errors.push(
      `widget '${widget.id}' has renderer '${widget.renderer}', which is not in the component registry.`,
    );
  }

  switch (widget.renderer) {
    case 'kpi-card': {
      requireValidName(
        widget.filter_by,
        'filter_by',
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      if (!(widget.format in formatterRegistry)) {
        errors.push(
          `widget '${widget.id}' format '${widget.format}' is not in the formatter registry.`,
        );
      }
      validateExclude({
        widgetId: widget.id,
        site: '',
        exclude: widget.exclude,
        filterByPresent: widget.filter_by !== undefined,
        vgplotMark: false,
        filterSpecIds,
        errors,
      });
      // A `$name` structured-select expression binds a declared variable
      // (compiled to a `column(param)`); validate each ref.
      validateStructuredQueryVariables(
        widget.query,
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      break;
    }
    case 'selection-table': {
      requireValidName(
        widget.filter_by,
        'filter_by',
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      requireValidName(
        widget.having_by,
        'having_by',
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      if (
        widget.metric_threshold !== undefined &&
        !(widget.metric_threshold.kind in kindRegistry)
      ) {
        errors.push(
          `widget '${widget.id}' metric_threshold kind '${widget.metric_threshold.kind}' is not in the kind registry.`,
        );
      }
      if (widget.sparkline !== undefined) {
        requireTable(
          widget.sparkline.table,
          'sparkline',
          widget.id,
          tables,
          errors,
        );
      }
      validateExclude({
        widgetId: widget.id,
        site: '',
        exclude: widget.exclude,
        // `filter_by` is required on a selection-table.
        filterByPresent: true,
        vgplotMark: false,
        filterSpecIds,
        errors,
      });
      // A `$name` structured-select expression binds a declared variable
      // (compiled to a `column(param)`); validate each ref.
      validateStructuredQueryVariables(
        widget.query,
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      break;
    }
    case 'data-table': {
      requireValidName(
        widget.filter_by,
        'filter_by',
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      requireTable(widget.query.from, 'query.from', widget.id, tables, errors);
      validateExclude({
        widgetId: widget.id,
        site: '',
        exclude: widget.exclude,
        // `filter_by` is required on a data-table.
        filterByPresent: true,
        vgplotMark: false,
        filterSpecIds,
        errors,
      });
      // A `$name` structured-select expression binds a declared variable
      // (compiled to a `column(param)`); validate each ref.
      validateStructuredQueryVariables(
        widget.query,
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      break;
    }
    case 'vgplot': {
      for (const mark of widget.plot.marks) {
        requireTable(
          mark.data.from,
          `plot mark '${mark.mark}' data.from`,
          widget.id,
          tables,
          errors,
        );
        requireValidName(
          mark.data.filter_by,
          `plot mark '${mark.mark}' data.filter_by`,
          widget.id,
          validNames,
          variableNames,
          errors,
        );
        validateExclude({
          widgetId: widget.id,
          site: `plot mark '${mark.mark}' `,
          exclude: mark.data.exclude,
          filterByPresent: mark.data.filter_by !== undefined,
          vgplotMark: true,
          filterSpecIds,
          errors,
        });
        // A `$name` channel binds a declared variable (compiled to a
        // `column(param)` the vgplot mark collects). Validate every channel ref;
        // a ref inside a bin/aggregate column is an unsupported position.
        for (const [name, channel] of [
          ['x', mark.x],
          ['y', mark.y],
          ['r', mark.r],
          ['opacity', mark.opacity],
          ['fill', mark.fill],
          ['stroke', mark.stroke],
        ] as const) {
          validateChannelVariables(
            channel,
            `plot mark '${mark.mark}' channel '${name}'`,
            widget.id,
            validNames,
            variableNames,
            errors,
          );
        }
      }
      for (const select of widget.plot.selects ?? []) {
        requireValidName(
          select.as,
          `plot select '${select.select}' as`,
          widget.id,
          validNames,
          variableNames,
          errors,
        );
        if (
          select.select === 'toggle' &&
          (select.channels ?? []).length === 0
        ) {
          errors.push(
            `widget '${widget.id}' plot select 'toggle' (as '${select.as}') requires a non-empty channels list.`,
          );
        }
      }
      break;
    }
    case 'variable-select': {
      // The one selection-inverse site: `variable` must name a declared
      // variable, never a Selection ref.
      requireVariableName(
        widget.variable,
        widget.id,
        validNames,
        variableNames,
        errors,
      );
      break;
    }
  }
}

/** Validate the `filter_kinds` section: known behaviors + resolvable targets. */
function validateFilterKinds(
  spec: DashboardSpec,
  validNames: Set<string>,
  tables: Set<string>,
  filterSetEntries: Array<string>,
  errors: Array<string>,
): void {
  const resolvesTarget = (target: string): boolean =>
    filterSetEntries.some((entry) => validNames.has(`${entry}.${target}`));

  for (const [name, def] of Object.entries(spec.filter_kinds ?? {})) {
    if (!isKnownBehavior(def.behavior)) {
      errors.push(
        `filter_kind '${name}' behavior '${def.behavior}' is not in the behavior registry.`,
      );
      continue;
    }
    const { config } = def;
    if (!tables.has(config.table)) {
      errors.push(
        `filter_kind '${name}' config.table '${config.table}' is not declared in data.tables.`,
      );
    }
    if (!resolvesTarget(config.having_target)) {
      errors.push(
        `filter_kind '${name}' config.having_target '${config.having_target}' does not resolve on any filter-set entry.`,
      );
    }
    if (!resolvesTarget(config.members_target)) {
      errors.push(
        `filter_kind '${name}' config.members_target '${config.members_target}' does not resolve on any filter-set entry.`,
      );
    }
  }
}

/**
 * Run every cross-reference check against a spec whose topology has already been
 * built (so `validNames` is available), whose kind registry has been built, and
 * whose derived filter spec ids (`filterSpecIds` — the ids a widget `exclude`
 * list may name) have been collected. `variableNames` is the set of declared
 * `variable` (topology-owned Param) names, kept distinct from `validNames` so a
 * selection-consuming site can reject a variable ref with a precise message.
 * Returns all violations.
 */
export function validateCrossReferences(
  spec: DashboardSpec,
  validNames: Set<string>,
  variableNames: Set<string>,
  kindRegistry: Record<string, FilterKind>,
  filterSpecIds: Set<string>,
): Array<string> {
  const errors: Array<string> = [];

  const tables = new Set(Object.keys(spec.data.tables));
  const widgetIds = new Set(Object.keys(spec.widgets));
  for (const widget of Object.values(spec.widgets)) {
    validateWidget(
      widget,
      validNames,
      variableNames,
      tables,
      kindRegistry,
      filterSpecIds,
      errors,
    );
  }

  const filterSetEntries = filterSetEntryNames(spec.topology);

  validateFilterKinds(spec, validNames, tables, filterSetEntries, errors);

  // Filter placements: kind must exist, and target must resolve under a
  // declared filter-set entry (`<entry>.<target>`).
  for (const field of spec.filters.fields) {
    for (const placement of field.placements) {
      if (!(placement.kind in kindRegistry)) {
        errors.push(
          `filter field '${field.id}' placement '${placement.label}' kind '${placement.kind}' is not in the kind registry.`,
        );
      }
      const resolvable = filterSetEntries.some((entry) =>
        validNames.has(`${entry}.${placement.target}`),
      );
      if (!resolvable) {
        errors.push(
          `filter field '${field.id}' placement '${placement.label}' target '${placement.target}' does not resolve on any filter-set entry.`,
        );
      }
    }
  }

  // Layout refs must name declared widgets.
  for (const [rowIndex, row] of spec.layout.rows.entries()) {
    for (const entry of row.widgets) {
      if (!widgetIds.has(entry.ref)) {
        errors.push(
          `layout row ${rowIndex} references widget '${entry.ref}', which is not declared.`,
        );
      }
    }
  }

  return errors;
}
