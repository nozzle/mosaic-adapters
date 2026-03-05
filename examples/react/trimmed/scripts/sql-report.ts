#!/usr/bin/env tsx
/**
 * SQL Report — Trimmed Example App
 *
 * Generates a markdown report of every SQL query shape used by the trimmed
 * example app: Athletes (flat + grouped), NYC Taxi, and Nozzle PAA views.
 *
 * Run: pnpm sql:report  (from repo root or this directory)
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mSql from '@uwdata/mosaic-sql';
import {
  analyzeQueries,
  generateMarkdown,
  printSummary,
} from '../../../../packages/mosaic-tanstack-table-core/src/sql-report.js';
import {
  buildGroupedLevelQuery,
  buildGroupedMultiSelectionPredicate,
  buildGroupedSelectionPredicate,
  buildLeafRowsQuery,
} from '../../../../packages/mosaic-tanstack-table-core/src/grouped/query-builder.js';
import type { QueryDefinition } from '../../../../packages/mosaic-tanstack-table-core/src/sql-report.js';
import type {
  GroupLevel,
  GroupMetric,
  LeafColumn,
} from '../../../../packages/mosaic-tanstack-table-core/src/grouped/types.js';

// ============================================================================
// Athletes View — Grouped Table
// ============================================================================

const ATHLETES_LEVELS: Array<GroupLevel> = [
  { column: 'nationality' },
  { column: 'sport' },
  { column: 'sex' },
];

const ATHLETES_METRICS: Array<GroupMetric> = [
  { id: 'count', expression: mSql.count(), label: 'Athletes' },
  { id: 'total_gold', expression: mSql.sum('gold'), label: 'Gold' },
  { id: 'total_silver', expression: mSql.sum('silver'), label: 'Silver' },
  { id: 'total_bronze', expression: mSql.sum('bronze'), label: 'Bronze' },
];

const ATHLETES_LEAF_COLUMNS: Array<LeafColumn> = [
  { column: 'name', label: 'Name' },
  { column: 'height', label: 'Height' },
  { column: 'weight', label: 'Weight' },
  { column: 'gold', label: 'Gold' },
  { column: 'silver', label: 'Silver' },
  { column: 'bronze', label: 'Bronze' },
];

function athletesGroupedQueries(): Array<QueryDefinition> {
  const defs: Array<QueryDefinition> = [];

  defs.push({
    name: 'Athletes: Root by nationality',
    builder: 'buildGroupedLevelQuery',
    description:
      'Root-level GROUP BY nationality with medal counts. This is the initial query when the grouped table loads.',
    sql: buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: ATHLETES_LEVELS,
      depth: 0,
      metrics: ATHLETES_METRICS,
      parentConstraints: {},
    }).toString(),
  });

  defs.push({
    name: 'Athletes: Sports within USA',
    builder: 'buildGroupedLevelQuery',
    description: 'Child-level GROUP BY sport, filtered to nationality=USA.',
    sql: buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: ATHLETES_LEVELS,
      depth: 1,
      metrics: ATHLETES_METRICS,
      parentConstraints: { nationality: 'USA' },
    }).toString(),
  });

  defs.push({
    name: 'Athletes: Gender within USA > Swimming',
    builder: 'buildGroupedLevelQuery',
    description:
      'Deepest GROUP BY sex, filtered to nationality=USA, sport=Swimming.',
    sql: buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: ATHLETES_LEVELS,
      depth: 2,
      metrics: ATHLETES_METRICS,
      parentConstraints: { nationality: 'USA', sport: 'Swimming' },
    }).toString(),
  });

  defs.push({
    name: 'Athletes: Root with cross-filter (sex=M)',
    builder: 'buildGroupedLevelQuery',
    description:
      'Root-level query filtered by histogram brush selecting Male athletes.',
    sql: buildGroupedLevelQuery({
      table: 'athletes',
      groupBy: ATHLETES_LEVELS,
      depth: 0,
      metrics: ATHLETES_METRICS,
      parentConstraints: {},
      filterPredicate: mSql.eq(mSql.column('sex'), mSql.literal('M')),
    }).toString(),
  });

  defs.push({
    name: 'Athletes: Leaf rows for USA > Swimming',
    builder: 'buildLeafRowsQuery',
    description:
      'Individual athlete rows when expanding the deepest group level.',
    sql: buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: ATHLETES_LEAF_COLUMNS,
      parentConstraints: { nationality: 'USA', sport: 'Swimming' },
    }).toString(),
  });

  defs.push({
    name: 'Athletes: Leaf rows SELECT * mode',
    builder: 'buildLeafRowsQuery',
    description: 'Leaf rows using selectAll=true (regex-replaced to SELECT *).',
    sql: buildLeafRowsQuery({
      table: 'athletes',
      leafColumns: ATHLETES_LEAF_COLUMNS,
      parentConstraints: { nationality: 'USA' },
      selectAll: true,
    }).toString(),
  });

  // Selection predicates
  const rootPred = buildGroupedSelectionPredicate({
    groupColumn: 'nationality',
    groupValue: 'USA',
    parentConstraints: {},
  });
  defs.push({
    name: 'Athletes: Selection predicate (root)',
    builder: 'buildGroupedSelectionPredicate',
    description: 'Cross-filter predicate when clicking a nationality row.',
    sql: `SELECT * FROM athletes WHERE ${rootPred.toString()}`,
  });

  const childPred = buildGroupedSelectionPredicate({
    groupColumn: 'sport',
    groupValue: 'Swimming',
    parentConstraints: { nationality: 'USA' },
  });
  defs.push({
    name: 'Athletes: Selection predicate (child)',
    builder: 'buildGroupedSelectionPredicate',
    description: 'Cross-filter predicate when clicking a sport row within USA.',
    sql: `SELECT * FROM athletes WHERE ${childPred.toString()}`,
  });

  const multiPred = buildGroupedMultiSelectionPredicate([
    {
      groupColumn: 'nationality',
      groupValue: 'USA',
      parentConstraints: {},
    },
    {
      groupColumn: 'nationality',
      groupValue: 'GBR',
      parentConstraints: {},
    },
    {
      groupColumn: 'nationality',
      groupValue: 'CHN',
      parentConstraints: {},
    },
  ]);
  defs.push({
    name: 'Athletes: Multi-select (3 nationalities)',
    builder: 'buildGroupedMultiSelectionPredicate',
    description:
      'OR predicate from selecting USA, GBR, and CHN simultaneously.',
    sql: `SELECT * FROM athletes WHERE ${multiPred!.toString()}`,
  });

  return defs;
}

// ============================================================================
// Athletes View — Flat Table Filters
// ============================================================================

function athletesFlatQueries(): Array<QueryDefinition> {
  const defs: Array<QueryDefinition> = [];

  defs.push({
    name: 'Athletes Flat: PARTIAL_ILIKE name search',
    builder: 'filter-factory (PARTIAL_ILIKE)',
    description: 'Text search on athlete name with ILIKE wrapping.',
    sql: `SELECT * FROM athletes WHERE "name" ILIKE '%phelps%'`,
  });

  defs.push({
    name: 'Athletes Flat: RANGE filter on height',
    builder: 'filter-factory (RANGE)',
    description:
      'Numeric range filter with TRY_CAST for height between 170-190.',
    sql: `SELECT * FROM athletes WHERE TRY_CAST("height" AS DOUBLE) BETWEEN 170 AND 190`,
  });

  defs.push({
    name: 'Athletes Flat: DATE_RANGE filter',
    builder: 'filter-factory (DATE_RANGE)',
    description: 'Date range filter on date_of_birth with TRY_CAST.',
    sql: `SELECT * FROM athletes WHERE TRY_CAST("date_of_birth" AS TIMESTAMP) BETWEEN '1990-01-01' AND '2000-12-31'`,
  });

  defs.push({
    name: 'Athletes Flat: EQUALS nationality filter',
    builder: 'filter-factory (EQUALS)',
    description: 'Exact match on nationality from facet dropdown.',
    sql: `SELECT * FROM athletes WHERE "nationality" = 'USA'`,
  });

  defs.push({
    name: 'Athletes Flat: Window function total rows',
    builder: 'buildTableQuery (window mode)',
    description:
      'COUNT(*) OVER() window function for total row count alongside data.',
    sql: `SELECT "name", "nationality", "sport", COUNT(*) OVER() AS "__total_rows" FROM "athletes" ORDER BY "name" ASC LIMIT 20 OFFSET 0`,
  });

  return defs;
}

// ============================================================================
// NYC Taxi View
// ============================================================================

function nycTaxiQueries(): Array<QueryDefinition> {
  const ZONE_SIZE = 1000;
  const defs: Array<QueryDefinition> = [];

  defs.push({
    name: 'NYC Taxi: Zone summary aggregation',
    builder: 'mSql.Query (custom factory)',
    description:
      'Zone-level GROUP BY with trip count and avg fare. Uses round(dx/1000) bucketing.',
    sql: mSql.Query.from('trips')
      .select({
        zone_x: mSql.sql`round(dx / ${ZONE_SIZE})`,
        zone_y: mSql.sql`round(dy / ${ZONE_SIZE})`,
        trip_count: mSql.count(),
        avg_fare: mSql.avg('fare_amount'),
      })
      .groupby('zone_x', 'zone_y')
      .toString(),
  });

  defs.push({
    name: 'NYC Taxi: Detail row hover predicate',
    builder: 'mSql.and (composite)',
    description:
      'Composite equality predicate for uniquely identifying a trip row on hover.',
    sql: `SELECT * FROM trips WHERE ("vendor_id" = '1') AND ("datetime" = '2024-01-15T08:30:00') AND ("fare_amount" = 25.50)`,
  });

  defs.push({
    name: 'NYC Taxi: Zone hover predicate',
    builder: 'mSql.sql (raw expression)',
    description:
      'Zone-level predicate using round() bucketing to match a hovered zone.',
    sql: `SELECT * FROM trips WHERE (round(dx / ${ZONE_SIZE}) = 5) AND (round(dy / ${ZONE_SIZE}) = 3)`,
  });

  defs.push({
    name: 'NYC Taxi: DATE_RANGE on datetime',
    builder: 'filter-factory (DATE_RANGE)',
    description: 'Timestamp range filter on trip datetime.',
    sql: `SELECT * FROM trips WHERE TRY_CAST("datetime" AS TIMESTAMP) >= '2024-01-01T00:00:00'`,
  });

  defs.push({
    name: 'NYC Taxi: RANGE on fare_amount',
    builder: 'filter-factory (RANGE)',
    description: 'Numeric range filter on fare.',
    sql: `SELECT * FROM trips WHERE TRY_CAST("fare_amount" AS DOUBLE) BETWEEN 10 AND 50`,
  });

  return defs;
}

// ============================================================================
// Nozzle PAA View
// ============================================================================

function nozzlePaaQueries(): Array<QueryDefinition> {
  const TABLE = 'nozzle_paa';
  const defs: Array<QueryDefinition> = [];

  defs.push({
    name: 'PAA: Keyword phrase summary',
    builder: 'mSql.Query (summary factory)',
    description:
      'GROUP BY phrase with MAX(search_volume) for the keyword summary table.',
    sql: mSql.Query.from(TABLE)
      .select({
        key: mSql.column('phrase'),
        metric: mSql.max('search_volume'),
      })
      .groupby('phrase')
      .orderby(mSql.desc(mSql.column('metric')))
      .limit(10)
      .toString(),
  });

  defs.push({
    name: 'PAA: Question count summary',
    builder: 'mSql.Query (summary factory)',
    description:
      'GROUP BY related_phrase.phrase with COUNT(*) for the PAA questions table.',
    sql: mSql.Query.from(TABLE)
      .select({
        key: mSql.sql`"related_phrase"."phrase"`,
        metric: mSql.count(),
      })
      .groupby(mSql.sql`"related_phrase"."phrase"`)
      .orderby(mSql.desc(mSql.column('metric')))
      .limit(10)
      .toString(),
  });

  defs.push({
    name: 'PAA: Domain count summary',
    builder: 'mSql.Query (summary factory)',
    description:
      'GROUP BY domain with COUNT(*) and NULL exclusion for the domain table.',
    sql: mSql.Query.from(TABLE)
      .select({
        key: mSql.column('domain'),
        metric: mSql.count(),
      })
      .where(mSql.sql`domain IS NOT NULL`)
      .groupby('domain')
      .orderby(mSql.desc(mSql.column('metric')))
      .limit(10)
      .toString(),
  });

  defs.push({
    name: 'PAA: URL count summary',
    builder: 'mSql.Query (summary factory)',
    description:
      'GROUP BY url with COUNT(*) and NULL exclusion for the URL table.',
    sql: mSql.Query.from(TABLE)
      .select({
        key: mSql.column('url'),
        metric: mSql.count(),
      })
      .where(mSql.sql`url IS NOT NULL`)
      .groupby('url')
      .orderby(mSql.desc(mSql.column('metric')))
      .limit(10)
      .toString(),
  });

  defs.push({
    name: 'PAA: Struct access filter (related_phrase.phrase)',
    builder: 'filter-factory (PARTIAL_ILIKE)',
    description: 'ILIKE filter on a nested struct column using dot notation.',
    sql: `SELECT * FROM nozzle_paa WHERE "related_phrase"."phrase" ILIKE '%how to%'`,
  });

  defs.push({
    name: 'PAA: Detail table with split total rows',
    builder: 'buildTableQuery (split mode)',
    description: 'Detail query for the PAA results table with pagination.',
    sql: `SELECT "domain", "related_phrase"."phrase" AS "paa_question", "title", "description" FROM "nozzle_paa" ORDER BY "domain" ASC LIMIT 20 OFFSET 0`,
  });

  return defs;
}

// ============================================================================
// Main
// ============================================================================

const definitions: Array<QueryDefinition> = [
  ...athletesGroupedQueries(),
  ...athletesFlatQueries(),
  ...nycTaxiQueries(),
  ...nozzlePaaQueries(),
];

const reports = analyzeQueries(definitions);
const markdown = generateMarkdown(reports, 'SQL Query Report — Trimmed App');

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'sql-report.md');
writeFileSync(outPath, markdown, 'utf-8');
printSummary(reports, outPath);
