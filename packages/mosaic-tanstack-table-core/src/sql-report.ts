/**
 * SQL Report Utilities
 *
 * Reusable functions for analyzing SQL queries via @polyglot-sql/sdk and
 * generating structured markdown reports. Consumers provide app-specific
 * query definitions; this module handles parsing, validation, formatting,
 * and markdown generation.
 *
 * NOTE: This module imports @polyglot-sql/sdk which is a devDependency.
 * It is intended for dev-time scripts and tests only — not bundled into
 * the production library output.
 */

import { ast, Dialect, format, parse, validate } from '@polyglot-sql/sdk';

const DIALECT = Dialect.DuckDB;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryStructure {
  tables: Array<string>;
  columns: Array<string>;
  features: Array<string>;
  nodeCount: number;
}

export interface QueryReport {
  name: string;
  builder: string;
  description: string;
  autoDescription: string;
  structure: QueryStructure;
  rawSql: string;
  formattedSql: string;
  valid: boolean;
  parseError?: string;
  warnings: Array<{ code: string; message: string }>;
}

export interface QueryDefinition {
  name: string;
  builder: string;
  description?: string;
  sql: string;
}

// ---------------------------------------------------------------------------
// AST introspection
// ---------------------------------------------------------------------------

function detectStructure(stmtAst: unknown): QueryStructure {
  const expr = stmtAst as import('@polyglot-sql/sdk').ast.Expression;
  const tables = ast.getTableNames(expr);
  const columns = ast.getColumnNames(expr);
  const features: Array<string> = [];

  if (ast.hasAggregates(expr)) {
    features.push('aggregates');
  }
  if (ast.hasWindowFunctions(expr)) {
    features.push('window functions');
  }
  if (ast.hasSubqueries(expr)) {
    features.push('subqueries');
  }

  // Detect clauses from the raw SQL (AST clause detection would require
  // deeper walker integration — regex on formatted SQL is reliable enough)
  const sqlUpper = expr ? String(expr) : '';
  // We'll fill these from the SQL string in analyzeQuery instead
  const count = ast.nodeCount(expr);

  return { tables, columns, features, nodeCount: count };
}

function buildAutoDescription(
  sql: string,
  structure: QueryStructure,
): string {
  const parts: Array<string> = [];

  // Statement type
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith('SELECT')) {
    parts.push('SELECT');
  } else if (upper.startsWith('INSERT')) {
    parts.push('INSERT');
  } else if (upper.startsWith('UPDATE')) {
    parts.push('UPDATE');
  } else if (upper.startsWith('DELETE')) {
    parts.push('DELETE');
  }

  // Tables
  if (structure.tables.length > 0) {
    parts.push(`from ${structure.tables.join(', ')}`);
  }

  // Clause detection from SQL text
  const clauses: Array<string> = [];
  const sqlUpper = sql.toUpperCase();
  if (sqlUpper.includes('WHERE')) {
    clauses.push('WHERE');
  }
  if (sqlUpper.includes('GROUP BY')) {
    clauses.push('GROUP BY');
  }
  if (sqlUpper.includes('HAVING')) {
    clauses.push('HAVING');
  }
  if (sqlUpper.includes('ORDER BY')) {
    clauses.push('ORDER BY');
  }
  if (sqlUpper.includes('LIMIT')) {
    clauses.push('LIMIT');
  }
  if (sqlUpper.includes('OFFSET')) {
    clauses.push('OFFSET');
  }
  if (sqlUpper.includes(' JOIN ')) {
    clauses.push('JOIN');
  }
  if (clauses.length > 0) {
    parts.push(`with ${clauses.join(', ')}`);
  }

  // Features from AST
  if (structure.features.length > 0) {
    parts.push(`using ${structure.features.join(', ')}`);
  }

  // Column count
  if (structure.columns.length > 0) {
    parts.push(`(${structure.columns.length} columns)`);
  }

  // Complexity
  parts.push(`[${structure.nodeCount} AST nodes]`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single SQL query: parse, validate semantics, format, and
 * auto-generate a structural description from the AST.
 */
export function analyzeQuery(def: QueryDefinition): QueryReport {
  const { name, builder, description, sql } = def;
  const parseResult = parse(sql, DIALECT);

  const emptyStructure: QueryStructure = {
    tables: [],
    columns: [],
    features: [],
    nodeCount: 0,
  };

  if (!parseResult.success) {
    return {
      name,
      builder,
      description: description ?? '',
      autoDescription: '',
      structure: emptyStructure,
      rawSql: sql,
      formattedSql: sql,
      valid: false,
      parseError: parseResult.error,
      warnings: [],
    };
  }

  // AST introspection
  const stmtAst =
    Array.isArray(parseResult.ast) && parseResult.ast.length > 0
      ? parseResult.ast[0]
      : parseResult.ast;
  const structure = stmtAst ? detectStructure(stmtAst) : emptyStructure;
  const autoDescription = buildAutoDescription(sql, structure);

  const validationResult = validate(sql, DIALECT, { semantic: true });
  const warnings = validationResult.errors
    .filter((e) => e.severity === 'warning')
    .map((e) => ({ code: e.code, message: e.message }));

  const formatResult = format(sql, DIALECT);
  const formattedSql =
    formatResult.success && formatResult.sql
      ? formatResult.sql.join(';\n')
      : sql;

  return {
    name,
    builder,
    description: description ?? '',
    autoDescription,
    structure,
    rawSql: sql,
    formattedSql,
    valid: true,
    warnings,
  };
}

/**
 * Analyze an array of query definitions and return reports.
 */
export function analyzeQueries(
  definitions: Array<QueryDefinition>,
): Array<QueryReport> {
  return definitions.map(analyzeQuery);
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

/**
 * Generate a markdown report from analyzed query reports.
 */
export function generateMarkdown(
  reports: Array<QueryReport>,
  title = 'SQL Query Report',
): string {
  const now = new Date().toISOString();
  const totalValid = reports.filter((r) => r.valid).length;
  const totalInvalid = reports.filter((r) => !r.valid).length;
  const totalWarnings = reports.reduce((sum, r) => sum + r.warnings.length, 0);

  const lines: Array<string> = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total queries analyzed**: ${reports.length}`);
  lines.push(`- **Valid**: ${totalValid} | **Invalid**: ${totalInvalid}`);
  lines.push(`- **Semantic warnings**: ${totalWarnings}`);
  lines.push(`- **Dialect**: DuckDB`);
  lines.push('');

  // Group by builder
  const grouped = new Map<string, Array<QueryReport>>();
  for (const r of reports) {
    const list = grouped.get(r.builder) ?? [];
    list.push(r);
    grouped.set(r.builder, list);
  }

  let idx = 1;

  for (const [builder, builderReports] of grouped) {
    lines.push(`## ${builder}`);
    lines.push('');

    for (const r of builderReports) {
      lines.push(`### ${idx}. ${r.name}`);
      lines.push('');
      lines.push(`**Builder**: \`${r.builder}\``);

      if (r.description) {
        lines.push(`**Description**: ${r.description}`);
      }

      // Auto-generated structural analysis
      if (r.autoDescription) {
        lines.push(`**Analysis**: ${r.autoDescription}`);
      }

      if (r.valid) {
        lines.push(`**Valid**: Yes`);
      } else {
        lines.push(`**Valid**: No`);
        lines.push(`**Error**: ${r.parseError}`);
      }

      // Structure details
      if (r.valid) {
        const s = r.structure;
        if (s.tables.length > 0) {
          lines.push(`**Tables**: ${s.tables.join(', ')}`);
        }
        if (s.columns.length > 0) {
          lines.push(`**Columns**: ${s.columns.join(', ')}`);
        }
        if (s.features.length > 0) {
          lines.push(`**Features**: ${s.features.join(', ')}`);
        }
        lines.push(`**Complexity**: ${s.nodeCount} AST nodes`);
      }

      if (r.warnings.length > 0) {
        const warningList = r.warnings
          .map((w) => `${w.code}: ${w.message}`)
          .join('; ');
        lines.push(`**Warnings**: ${warningList}`);
      }

      lines.push('');
      lines.push('**Formatted SQL**:');
      lines.push('');
      lines.push('```sql');
      lines.push(r.formattedSql);
      lines.push('```');
      lines.push('');

      if (r.formattedSql !== r.rawSql) {
        lines.push('<details>');
        lines.push('<summary>Raw SQL (single-line)</summary>');
        lines.push('');
        lines.push('```sql');
        lines.push(r.rawSql);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
      idx++;
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI helper
// ---------------------------------------------------------------------------

/**
 * Print a summary to stdout and exit with code 1 if any queries are invalid.
 */
export function printSummary(
  reports: Array<QueryReport>,
  outPath: string,
): void {
  const valid = reports.filter((r) => r.valid).length;
  const invalid = reports.filter((r) => !r.valid).length;
  const warnings = reports.reduce((s, r) => s + r.warnings.length, 0);

  console.log(`SQL Report generated: ${outPath}`);
  console.log(
    `  ${reports.length} queries | ${valid} valid | ${invalid} invalid | ${warnings} warnings`,
  );

  if (invalid > 0) {
    console.error('\nInvalid queries detected:');
    for (const r of reports.filter((r) => !r.valid)) {
      console.error(`  - ${r.name}: ${r.parseError}`);
    }
    process.exit(1);
  }
}
