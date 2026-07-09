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
 * - raw-template `{{where}}` / `{{having}}` placeholders match the widget's
 *   `filter_by` / `having_by` presence;
 * - every `filter_kinds` entry names a known behavior, and its `having_target` /
 *   `members_target` resolve under a declared `filter-set` entry;
 * - every table referenced by `filter_kinds`, vgplot marks, and sparklines
 *   exists in `data.tables`;
 * - every filter placement `kind` is in the kind registry, and its `target`
 *   resolves under a declared `filter-set` entry;
 * - every `metric_threshold.kind` is in the kind registry;
 * - every layout `ref` names a declared widget.
 */
import { formatterRegistry } from '../widgets/formatters';
import { widgetRegistry } from '../widgets/registry';
import {
  statementHasHavingPlaceholder,
  statementHasWherePlaceholder,
} from './query-compiler';
import { isKnownBehavior } from './kinds';
import { filterSetEntryNames } from './topology';
import type { FilterKind } from '@nozzleio/react-mosaic';
import type { DashboardSpec, WidgetSpec } from './schema';

/** Validate the placeholder rules for a raw-template widget. */
function validatePlaceholders(
  widget: Extract<WidgetSpec, { renderer: 'kpi-card' | 'selection-table' }>,
  errors: Array<string>,
): void {
  const statement = widget.query.statement;
  const hasFilterBy = widget.filter_by !== undefined;
  const hasHavingBy =
    widget.renderer === 'selection-table' && widget.having_by !== undefined;
  const hasWhere = statementHasWherePlaceholder(statement);
  const hasHaving = statementHasHavingPlaceholder(statement);

  if (hasFilterBy && !hasWhere) {
    errors.push(
      `widget '${widget.id}' has a filter_by but its query omits the required {{where}} placeholder.`,
    );
  }
  if (!hasFilterBy && hasWhere) {
    errors.push(
      `widget '${widget.id}' references {{where}} but declares no filter_by — the placeholder is meaningless.`,
    );
  }
  if (hasHavingBy && !hasHaving) {
    errors.push(
      `widget '${widget.id}' has a having_by but its query omits the required {{having}} placeholder.`,
    );
  }
  if (!hasHavingBy && hasHaving) {
    errors.push(
      `widget '${widget.id}' references {{having}} but declares no having_by — the placeholder is meaningless.`,
    );
  }
}

/** Check a topology ref is resolvable, recording an error if not. */
function requireValidName(
  ref: string | undefined,
  role: string,
  widgetId: string,
  validNames: Set<string>,
  errors: Array<string>,
): void {
  if (ref === undefined) {
    return;
  }
  if (!validNames.has(ref)) {
    errors.push(
      `widget '${widgetId}' ${role} '${ref}' is not a topology selection ref.`,
    );
  }
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

function validateWidget(
  widget: WidgetSpec,
  validNames: Set<string>,
  tables: Set<string>,
  kindRegistry: Record<string, FilterKind>,
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
        errors,
      );
      if (!(widget.format in formatterRegistry)) {
        errors.push(
          `widget '${widget.id}' format '${widget.format}' is not in the formatter registry.`,
        );
      }
      validatePlaceholders(widget, errors);
      break;
    }
    case 'selection-table': {
      requireValidName(
        widget.filter_by,
        'filter_by',
        widget.id,
        validNames,
        errors,
      );
      requireValidName(
        widget.having_by,
        'having_by',
        widget.id,
        validNames,
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
      validatePlaceholders(widget, errors);
      break;
    }
    case 'data-table': {
      requireValidName(
        widget.filter_by,
        'filter_by',
        widget.id,
        validNames,
        errors,
      );
      requireTable(widget.query.from, 'query.from', widget.id, tables, errors);
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
          errors,
        );
      }
      for (const select of widget.plot.selects ?? []) {
        requireValidName(
          select.as,
          `plot select '${select.select}' as`,
          widget.id,
          validNames,
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
 * built (so `validNames` is available) and whose kind registry has been built.
 * Returns all violations.
 */
export function validateCrossReferences(
  spec: DashboardSpec,
  validNames: Set<string>,
  kindRegistry: Record<string, FilterKind>,
): Array<string> {
  const errors: Array<string> = [];

  const tables = new Set(Object.keys(spec.data.tables));
  const widgetIds = new Set(Object.keys(spec.widgets));
  for (const widget of Object.values(spec.widgets)) {
    validateWidget(widget, validNames, tables, kindRegistry, errors);
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
