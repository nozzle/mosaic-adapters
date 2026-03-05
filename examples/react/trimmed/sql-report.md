# SQL Query Report — Trimmed App

Generated: 2026-02-27T21:45:05.500Z

## Summary

- **Total queries analyzed**: 25
- **Valid**: 25 | **Invalid**: 0
- **Semantic warnings**: 14
- **Dialect**: DuckDB

## buildGroupedLevelQuery

### 1. Athletes: Root by nationality

**Builder**: `buildGroupedLevelQuery`
**Description**: Root-level GROUP BY nationality with medal counts. This is the initial query when the grouped table loads.
**Analysis**: SELECT from athletes with GROUP BY, ORDER BY, LIMIT using aggregates (3 columns) [14 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality, nationality, count
**Features**: aggregates
**Complexity**: 14 AST nodes

**Formatted SQL**:

```sql
SELECT
  "nationality",
  COUNT(*) AS "count",
  SUM("gold") AS "total_gold",
  SUM("silver") AS "total_silver",
  SUM("bronze") AS "total_bronze"
FROM "athletes"
GROUP BY
  "nationality"
ORDER BY
  "count" DESC
LIMIT 200
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "nationality", count(*) AS "count", sum("gold") AS "total_gold", sum("silver") AS "total_silver", sum("bronze") AS "total_bronze" FROM "athletes" GROUP BY "nationality" ORDER BY "count" DESC LIMIT 200
```

</details>

---

### 2. Athletes: Sports within USA

**Builder**: `buildGroupedLevelQuery`
**Description**: Child-level GROUP BY sport, filtered to nationality=USA.
**Analysis**: SELECT from athletes with WHERE, GROUP BY, ORDER BY, LIMIT using aggregates (4 columns) [18 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: sport, nationality, sport, count
**Features**: aggregates
**Complexity**: 18 AST nodes

**Formatted SQL**:

```sql
SELECT
  "sport",
  COUNT(*) AS "count",
  SUM("gold") AS "total_gold",
  SUM("silver") AS "total_silver",
  SUM("bronze") AS "total_bronze"
FROM "athletes"
WHERE
  (
    "nationality" = 'USA'
  )
GROUP BY
  "sport"
ORDER BY
  "count" DESC
LIMIT 200
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "sport", count(*) AS "count", sum("gold") AS "total_gold", sum("silver") AS "total_silver", sum("bronze") AS "total_bronze" FROM "athletes" WHERE ("nationality" = 'USA') GROUP BY "sport" ORDER BY "count" DESC LIMIT 200
```

</details>

---

### 3. Athletes: Gender within USA > Swimming

**Builder**: `buildGroupedLevelQuery`
**Description**: Deepest GROUP BY sex, filtered to nationality=USA, sport=Swimming.
**Analysis**: SELECT from athletes with WHERE, GROUP BY, ORDER BY, LIMIT using aggregates (5 columns) [24 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: sex, nationality, sport, sex, count
**Features**: aggregates
**Complexity**: 24 AST nodes

**Formatted SQL**:

```sql
SELECT
  "sex",
  COUNT(*) AS "count",
  SUM("gold") AS "total_gold",
  SUM("silver") AS "total_silver",
  SUM("bronze") AS "total_bronze"
FROM "athletes"
WHERE
  (
    (
      "nationality" = 'USA'
    ) AND (
      "sport" = 'Swimming'
    )
  )
GROUP BY
  "sex"
ORDER BY
  "count" DESC
LIMIT 200
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "sex", count(*) AS "count", sum("gold") AS "total_gold", sum("silver") AS "total_silver", sum("bronze") AS "total_bronze" FROM "athletes" WHERE (("nationality" = 'USA') AND ("sport" = 'Swimming')) GROUP BY "sex" ORDER BY "count" DESC LIMIT 200
```

</details>

---

### 4. Athletes: Root with cross-filter (sex=M)

**Builder**: `buildGroupedLevelQuery`
**Description**: Root-level query filtered by histogram brush selecting Male athletes.
**Analysis**: SELECT from athletes with WHERE, GROUP BY, ORDER BY, LIMIT using aggregates (4 columns) [18 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality, sex, nationality, count
**Features**: aggregates
**Complexity**: 18 AST nodes

**Formatted SQL**:

```sql
SELECT
  "nationality",
  COUNT(*) AS "count",
  SUM("gold") AS "total_gold",
  SUM("silver") AS "total_silver",
  SUM("bronze") AS "total_bronze"
FROM "athletes"
WHERE
  (
    "sex" = 'M'
  )
GROUP BY
  "nationality"
ORDER BY
  "count" DESC
LIMIT 200
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "nationality", count(*) AS "count", sum("gold") AS "total_gold", sum("silver") AS "total_silver", sum("bronze") AS "total_bronze" FROM "athletes" WHERE ("sex" = 'M') GROUP BY "nationality" ORDER BY "count" DESC LIMIT 200
```

</details>

---

## buildLeafRowsQuery

### 5. Athletes: Leaf rows for USA > Swimming

**Builder**: `buildLeafRowsQuery`
**Description**: Individual athlete rows when expanding the deepest group level.
**Analysis**: SELECT from athletes with WHERE, ORDER BY, LIMIT (9 columns) [20 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: name, height, weight, gold, silver, bronze, nationality, sport, name
**Complexity**: 20 AST nodes

**Formatted SQL**:

```sql
SELECT
  "name",
  "height",
  "weight",
  "gold",
  "silver",
  "bronze"
FROM "athletes"
WHERE
  (
    (
      "nationality" = 'USA'
    ) AND (
      "sport" = 'Swimming'
    )
  )
ORDER BY
  "name" DESC
LIMIT 100
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "name", "height", "weight", "gold", "silver", "bronze" FROM "athletes" WHERE (("nationality" = 'USA') AND ("sport" = 'Swimming')) ORDER BY "name" DESC LIMIT 100
```

</details>

---

### 6. Athletes: Leaf rows SELECT * mode

**Builder**: `buildLeafRowsQuery`
**Description**: Leaf rows using selectAll=true (regex-replaced to SELECT *).
**Analysis**: SELECT from athletes with WHERE, ORDER BY, LIMIT (2 columns) [9 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality, name
**Complexity**: 9 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM "athletes"
WHERE
  (
    "nationality" = 'USA'
  )
ORDER BY
  "name" DESC
LIMIT 100
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM "athletes" WHERE ("nationality" = 'USA') ORDER BY "name" DESC LIMIT 100
```

</details>

---

## buildGroupedSelectionPredicate

### 7. Athletes: Selection predicate (root)

**Builder**: `buildGroupedSelectionPredicate`
**Description**: Cross-filter predicate when clicking a nationality row.
**Analysis**: SELECT from athletes with WHERE (1 columns) [7 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality
**Complexity**: 7 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  (
    "nationality" = 'USA'
  )
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE ("nationality" = 'USA')
```

</details>

---

### 8. Athletes: Selection predicate (child)

**Builder**: `buildGroupedSelectionPredicate`
**Description**: Cross-filter predicate when clicking a sport row within USA.
**Analysis**: SELECT from athletes with WHERE (2 columns) [13 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality, sport
**Complexity**: 13 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  (
    (
      "nationality" = 'USA'
    ) AND (
      "sport" = 'Swimming'
    )
  )
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE (("nationality" = 'USA') AND ("sport" = 'Swimming'))
```

</details>

---

## buildGroupedMultiSelectionPredicate

### 9. Athletes: Multi-select (3 nationalities)

**Builder**: `buildGroupedMultiSelectionPredicate`
**Description**: OR predicate from selecting USA, GBR, and CHN simultaneously.
**Analysis**: SELECT from athletes with WHERE (3 columns) [18 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality, nationality, nationality
**Complexity**: 18 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  (
    (
      "nationality" = 'USA'
    ) OR (
      "nationality" = 'GBR'
    ) OR (
      "nationality" = 'CHN'
    )
  )
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE (("nationality" = 'USA') OR ("nationality" = 'GBR') OR ("nationality" = 'CHN'))
```

</details>

---

## filter-factory (PARTIAL_ILIKE)

### 10. Athletes Flat: PARTIAL_ILIKE name search

**Builder**: `filter-factory (PARTIAL_ILIKE)`
**Description**: Text search on athlete name with ILIKE wrapping.
**Analysis**: SELECT from athletes with WHERE (1 columns) [6 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: name
**Complexity**: 6 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  "name" ILIKE '%phelps%'
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE "name" ILIKE '%phelps%'
```

</details>

---

### 11. PAA: Struct access filter (related_phrase.phrase)

**Builder**: `filter-factory (PARTIAL_ILIKE)`
**Description**: ILIKE filter on a nested struct column using dot notation.
**Analysis**: SELECT from nozzle_paa with WHERE (1 columns) [6 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: phrase
**Complexity**: 6 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM nozzle_paa
WHERE
  "related_phrase"."phrase" ILIKE '%how to%'
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM nozzle_paa WHERE "related_phrase"."phrase" ILIKE '%how to%'
```

</details>

---

## filter-factory (RANGE)

### 12. Athletes Flat: RANGE filter on height

**Builder**: `filter-factory (RANGE)`
**Description**: Numeric range filter with TRY_CAST for height between 170-190.
**Analysis**: SELECT from athletes with WHERE [7 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Complexity**: 7 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  TRY_CAST("height" AS DOUBLE) BETWEEN 170 AND 190
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE TRY_CAST("height" AS DOUBLE) BETWEEN 170 AND 190
```

</details>

---

### 13. NYC Taxi: RANGE on fare_amount

**Builder**: `filter-factory (RANGE)`
**Description**: Numeric range filter on fare.
**Analysis**: SELECT from trips with WHERE [7 AST nodes]
**Valid**: Yes
**Tables**: trips
**Complexity**: 7 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM trips
WHERE
  TRY_CAST("fare_amount" AS DOUBLE) BETWEEN 10 AND 50
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM trips WHERE TRY_CAST("fare_amount" AS DOUBLE) BETWEEN 10 AND 50
```

</details>

---

## filter-factory (DATE_RANGE)

### 14. Athletes Flat: DATE_RANGE filter

**Builder**: `filter-factory (DATE_RANGE)`
**Description**: Date range filter on date_of_birth with TRY_CAST.
**Analysis**: SELECT from athletes with WHERE [7 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Complexity**: 7 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  TRY_CAST("date_of_birth" AS TIMESTAMP) BETWEEN '1990-01-01' AND '2000-12-31'
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE TRY_CAST("date_of_birth" AS TIMESTAMP) BETWEEN '1990-01-01' AND '2000-12-31'
```

</details>

---

### 15. NYC Taxi: DATE_RANGE on datetime

**Builder**: `filter-factory (DATE_RANGE)`
**Description**: Timestamp range filter on trip datetime.
**Analysis**: SELECT from trips with WHERE [6 AST nodes]
**Valid**: Yes
**Tables**: trips
**Complexity**: 6 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM trips
WHERE
  TRY_CAST("datetime" AS TIMESTAMP) >= '2024-01-01T00:00:00'
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM trips WHERE TRY_CAST("datetime" AS TIMESTAMP) >= '2024-01-01T00:00:00'
```

</details>

---

## filter-factory (EQUALS)

### 16. Athletes Flat: EQUALS nationality filter

**Builder**: `filter-factory (EQUALS)`
**Description**: Exact match on nationality from facet dropdown.
**Analysis**: SELECT from athletes with WHERE (1 columns) [6 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: nationality
**Complexity**: 6 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM athletes
WHERE
  "nationality" = 'USA'
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM athletes WHERE "nationality" = 'USA'
```

</details>

---

## buildTableQuery (window mode)

### 17. Athletes Flat: Window function total rows

**Builder**: `buildTableQuery (window mode)`
**Description**: COUNT(*) OVER() window function for total row count alongside data.
**Analysis**: SELECT from athletes with ORDER BY, LIMIT, OFFSET using aggregates, window functions (4 columns) [11 AST nodes]
**Valid**: Yes
**Tables**: athletes
**Columns**: name, nationality, sport, name
**Features**: aggregates, window functions
**Complexity**: 11 AST nodes
**Warnings**: W002: Mixing aggregate functions with non-aggregated columns without GROUP BY may cause errors in strict SQL mode

**Formatted SQL**:

```sql
SELECT
  "name",
  "nationality",
  "sport",
  COUNT(*) OVER () AS "__total_rows"
FROM "athletes"
ORDER BY
  "name" ASC
LIMIT 20
OFFSET 0
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "name", "nationality", "sport", COUNT(*) OVER() AS "__total_rows" FROM "athletes" ORDER BY "name" ASC LIMIT 20 OFFSET 0
```

</details>

---

## mSql.Query (custom factory)

### 18. NYC Taxi: Zone summary aggregation

**Builder**: `mSql.Query (custom factory)`
**Description**: Zone-level GROUP BY with trip count and avg fare. Uses round(dx/1000) bucketing.
**Analysis**: SELECT from trips with GROUP BY using aggregates (4 columns) [18 AST nodes]
**Valid**: Yes
**Tables**: trips
**Columns**: dx, dy, zone_x, zone_y
**Features**: aggregates
**Complexity**: 18 AST nodes

**Formatted SQL**:

```sql
SELECT
  ROUND(dx / 1000) AS "zone_x",
  ROUND(dy / 1000) AS "zone_y",
  COUNT(*) AS "trip_count",
  AVG("fare_amount") AS "avg_fare"
FROM "trips"
GROUP BY
  "zone_x",
  "zone_y"
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT round(dx / 1000) AS "zone_x", round(dy / 1000) AS "zone_y", count(*) AS "trip_count", avg("fare_amount") AS "avg_fare" FROM "trips" GROUP BY "zone_x", "zone_y"
```

</details>

---

## mSql.and (composite)

### 19. NYC Taxi: Detail row hover predicate

**Builder**: `mSql.and (composite)`
**Description**: Composite equality predicate for uniquely identifying a trip row on hover.
**Analysis**: SELECT from trips with WHERE (3 columns) [17 AST nodes]
**Valid**: Yes
**Tables**: trips
**Columns**: vendor_id, datetime, fare_amount
**Complexity**: 17 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM trips
WHERE
  (
    "vendor_id" = '1'
  ) AND (
    "datetime" = '2024-01-15T08:30:00'
  ) AND (
    "fare_amount" = 25.50
  )
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM trips WHERE ("vendor_id" = '1') AND ("datetime" = '2024-01-15T08:30:00') AND ("fare_amount" = 25.50)
```

</details>

---

## mSql.sql (raw expression)

### 20. NYC Taxi: Zone hover predicate

**Builder**: `mSql.sql (raw expression)`
**Description**: Zone-level predicate using round() bucketing to match a hovered zone.
**Analysis**: SELECT from trips with WHERE (2 columns) [18 AST nodes]
**Valid**: Yes
**Tables**: trips
**Columns**: dx, dy
**Complexity**: 18 AST nodes
**Warnings**: W001: SELECT * is discouraged; specify columns explicitly for better performance and maintainability

**Formatted SQL**:

```sql
SELECT
  *
FROM trips
WHERE
  (
    ROUND(dx / 1000) = 5
  ) AND (
    ROUND(dy / 1000) = 3
  )
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT * FROM trips WHERE (round(dx / 1000) = 5) AND (round(dy / 1000) = 3)
```

</details>

---

## mSql.Query (summary factory)

### 21. PAA: Keyword phrase summary

**Builder**: `mSql.Query (summary factory)`
**Description**: GROUP BY phrase with MAX(search_volume) for the keyword summary table.
**Analysis**: SELECT from nozzle_paa with GROUP BY, ORDER BY, LIMIT using aggregates (3 columns) [9 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: phrase, phrase, metric
**Features**: aggregates
**Complexity**: 9 AST nodes

**Formatted SQL**:

```sql
SELECT
  "phrase" AS "key",
  MAX("search_volume") AS "metric"
FROM "nozzle_paa"
GROUP BY
  "phrase"
ORDER BY
  "metric" DESC
LIMIT 10
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "phrase" AS "key", max("search_volume") AS "metric" FROM "nozzle_paa" GROUP BY "phrase" ORDER BY "metric" DESC LIMIT 10
```

</details>

---

### 22. PAA: Question count summary

**Builder**: `mSql.Query (summary factory)`
**Description**: GROUP BY related_phrase.phrase with COUNT(*) for the PAA questions table.
**Analysis**: SELECT from nozzle_paa with GROUP BY, ORDER BY, LIMIT using aggregates (3 columns) [9 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: phrase, phrase, metric
**Features**: aggregates
**Complexity**: 9 AST nodes

**Formatted SQL**:

```sql
SELECT
  "related_phrase"."phrase" AS "key",
  COUNT(*) AS "metric"
FROM "nozzle_paa"
GROUP BY
  "related_phrase"."phrase"
ORDER BY
  "metric" DESC
LIMIT 10
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "related_phrase"."phrase" AS "key", count(*) AS "metric" FROM "nozzle_paa" GROUP BY "related_phrase"."phrase" ORDER BY "metric" DESC LIMIT 10
```

</details>

---

### 23. PAA: Domain count summary

**Builder**: `mSql.Query (summary factory)`
**Description**: GROUP BY domain with COUNT(*) and NULL exclusion for the domain table.
**Analysis**: SELECT from nozzle_paa with WHERE, GROUP BY, ORDER BY, LIMIT using aggregates (4 columns) [11 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: domain, domain, domain, metric
**Features**: aggregates
**Complexity**: 11 AST nodes

**Formatted SQL**:

```sql
SELECT
  "domain" AS "key",
  COUNT(*) AS "metric"
FROM "nozzle_paa"
WHERE
  domain IS NOT NULL
GROUP BY
  "domain"
ORDER BY
  "metric" DESC
LIMIT 10
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "domain" AS "key", count(*) AS "metric" FROM "nozzle_paa" WHERE domain IS NOT NULL GROUP BY "domain" ORDER BY "metric" DESC LIMIT 10
```

</details>

---

### 24. PAA: URL count summary

**Builder**: `mSql.Query (summary factory)`
**Description**: GROUP BY url with COUNT(*) and NULL exclusion for the URL table.
**Analysis**: SELECT from nozzle_paa with WHERE, GROUP BY, ORDER BY, LIMIT using aggregates (4 columns) [11 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: url, url, url, metric
**Features**: aggregates
**Complexity**: 11 AST nodes

**Formatted SQL**:

```sql
SELECT
  "url" AS "key",
  COUNT(*) AS "metric"
FROM "nozzle_paa"
WHERE
  url IS NOT NULL
GROUP BY
  "url"
ORDER BY
  "metric" DESC
LIMIT 10
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "url" AS "key", count(*) AS "metric" FROM "nozzle_paa" WHERE url IS NOT NULL GROUP BY "url" ORDER BY "metric" DESC LIMIT 10
```

</details>

---

## buildTableQuery (split mode)

### 25. PAA: Detail table with split total rows

**Builder**: `buildTableQuery (split mode)`
**Description**: Detail query for the PAA results table with pagination.
**Analysis**: SELECT from nozzle_paa with ORDER BY, LIMIT, OFFSET (5 columns) [10 AST nodes]
**Valid**: Yes
**Tables**: nozzle_paa
**Columns**: domain, phrase, title, description, domain
**Complexity**: 10 AST nodes

**Formatted SQL**:

```sql
SELECT
  "domain",
  "related_phrase"."phrase" AS "paa_question",
  "title",
  "description"
FROM "nozzle_paa"
ORDER BY
  "domain" ASC
LIMIT 20
OFFSET 0
```

<details>
<summary>Raw SQL (single-line)</summary>

```sql
SELECT "domain", "related_phrase"."phrase" AS "paa_question", "title", "description" FROM "nozzle_paa" ORDER BY "domain" ASC LIMIT 20 OFFSET 0
```

</details>

---
