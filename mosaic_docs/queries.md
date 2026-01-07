# Queries

Mosaic SQL provides a fluent API for building structured SQL queries. These objects are analyzed by the Coordinator to optimize data transfer.

## Query.from

`Query.from(table)`

Start a new Select query from a table name or a subquery.

## select

`query.select(...expressions)`

Specify the columns to return. Accepts strings, column references, or objects for aliasing:
`query.select({ total: count(), avg_val: avg('col') })`

## where

`query.where(...predicates)`

Add filter criteria. Multiple calls append predicates with `AND`.

## groupby

`query.groupby(...expressions)`

Group results for aggregate functions.

## with

`query.with(definitions)`

Define Common Table Expressions (CTEs).
`Query.with({ temp: Query.from('data').where('x > 1') }).from('temp')`

## Set Operations

- `Query.union(...queries)`
- `Query.intersect(...queries)`
- `Query.except(...queries)`

## toString

`query.toString()`

Convert the query object into a standard SQL string.
