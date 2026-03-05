Queries
SQL query builders. These utilities build structured representations of queries that are easier to create, manipulate, and analyze.

For example, here is a basic group-by aggregation query that counts the number of records and adds up values by category:

import { Query, count, gt, sum } from "@uwdata/mosaic-sql";

// SELECT "column", count() AS "count", sum("value") AS "value"
// FROM "table" WHERE "value" > 0 GROUP BY "column"
Query
.from("table")
.select("category", { count: count(), sum: sum("value") })
.groupby("category")
.where(gt("value", 0))
Here is an overview of available methods:

Query
.with(/_ a map of named common table expression queries _/)
.select(/_ column names or name -> expression maps _/)
.distinct(/_ boolean to denote distinct values only _/)
.from(/_ source table names or subqueries _/)
.sample(/_ number of rows or % to sample _/)
.where(/_ filter criteria _/)
.groupby(/_ columns or expressions to group by _/)
.having(/_ post-aggregation filter criteria _/)
.window(/_ named window definitions _/)
.qualify(/_ post-window filter criteria _/)
.orderby(/_ columns or expressions to sort by _/)
.limit(/_ max number of rows _/)
.offset(/_ offet number of rows _/)
To learn more about the anatomy of a query, take a look at the DuckDB Select statement documentation.

Query
The top-level Query class, along with its concrete SelectQuery and SetOperation subclasses, provide structured representations of SQL queries. Upon string coercion, these objects produce a complete SQL query string.

The following static methods create a new SelectQuery and invoke the corresponding method:

Query.select(): See the select method below.
Query.from(): See the from method below.
In addition, the following static methods take multiple queries as input and return SetOperation instances:

Query.union(...queries): Union results with de-duplication of rows.
Query.unionByName(...queries): Union results with de-duplication of rows, combining rows from different tables by name, instead of by position.
Query.unionAll(...queries): Union results with no de-duplication of rows.
Query.unionAllByName(...queries): Union results with no de-duplication of rows, combining rows from different tables by name, instead of by position.
Query.intersect(...queries): Query for distinct rows that are output by both the left and right input queries.
Query.intersectAll(...queries): Query for all rows that are output by both the left and right input queries using bag semantics, so duplicates are returned.
Query.except(...queries): Query for distinct rows from the left input query that aren't output by the right input query.
Query.exceptAll(...queries): Query for all rows from the left input query that aren't output by the right input query using bag semantics, so duplicates are returned.
Common table expressions can be applied via static method

Query.with(): See the with method below.
Each of the methods described above can also be utilized in conjunction with a WITH clause. For example, Query.with().select() results in a SelectQuery, whereas Query.with().union() will produce a SetOperation.

To instead create a query for metadata (column names and types), pass a query to the static describe method:

Query.describe(query): Request a description of the columns that a query will produce, with one row per selected column.
clone
Query.clone()

Return a new query that is a shallow copy of the current instance.

subqueries
Query.subqueries

The subqueries getter property returns an array of subquery instances, or an empty array if there are no subqueries. For selection queries, the subqueries may include common table expressions within WITH or nested queries within FROM. For set operations, the subqueries are the set operation arguments.

toString
Query.toString()

Coerce this query object to a SQL query string.

select
SelectQuery.select(...expressions)

Select columns and return this query instance. The expressions argument may include column name strings, column references, and maps from column names to expressions (either as JavaScript object values or nested key-value arrays as produced by Object.entries).

from
SelectQuery.from(...tables)

Indicate the tables to draw records from and return this query instance. The tables may be table name strings, queries or subquery expressions, and maps from table names to expressions (either as JavaScript object values or nested key-value arrays as produced by Object.entries).

with
Query.with(...expressions)

Provide a set of named subqueries in the form of common table expressions (CTEs) and return this query instance. The input expressions should consist of one or more maps (as JavaScript object values) from subquery names to query expressions and/or CTE instances produced by the cte method.

distinct
SelectQuery.distinct(value = true)

Update the query to require DISTINCT values and return this query instance.

sample
SelectQuery.sample(size, method)

Update the query to sample a subset of rows and return this query instance. If size is a number between 0 and 1, it is interpreted as a percentage of the full dataset to sample. Otherwise, it is interpreted as the number of rows to sample. The method argument is a string indicating the sample method, such as "reservoir", "bernoulli" and "system". See the DuckDB Sample documentation for more.

where
SelectQuery.where(...expressions)

Update the query to additionally filter by the provided predicate expressions and return this query instance. This method is additive: any previously defined filter criteria will still remain.

groupby
SelectQuery.groupby(...expressions)

Update the query to additionally group by the provided expressions and return this query instance. This method is additive: any previously defined group by criteria will still remain.

having
SelectQuery.having(...expressions)

Update the query to additionally filter aggregate results by the provided predicate expressions and return this query instance. Unlike where criteria, which are applied before an aggregation, the having criteria are applied to aggregated results. This method is additive: any previously defined filter criteria will still remain.

window
SelectQuery.window(...expressions)

Update the query with named window frame definitions and return this query instance. The expressions arguments should be JavaScript object values that map from window names to window frame definitions. This method is additive: any previously defined windows will still remain.

qualify
SelectQuery.qualify(...expressions)

Update the query to additionally filter windowed results by the provided predicate expressions and return this query instance. Use this method instead of where to filter the results of window operations. This method is additive: any previously defined filter criteria will still remain.

orderby
Query.orderby(...expressions)

Update the query to additionally order results by the provided expressions and return this query instance. This method is additive: any previously defined sort criteria will still remain.

limit
Query.limit(rows)

Update the query to limit results to the specified number of rows and return this query instance.

offset
Query.offset(rows)

Update the query to offset the results by the specified number of rows and return this query instance.

SQL Expressions
SQL expression builders. All SQL expressions are represented in the form of an abstract syntax tree (AST). Helper methods and functions build out this tree.

column
column(name)

Create an expression AST node that references a column by name. Upon string coercion, the column name will be properly quoted.

cte
cte(name, query, materialized)

Create an AST node for a Common Table Expression (CTE) to be used within a SQL WITH clause. The resulting node can be passed as an argument to the Query.with() method. The string-valued name and Query-valued query arguments are required. The optional boolean-valued materialized argument indicates if the CTE should be materialized during query execution; if unspecified, it is left to the backing database to decide.

literal
literal(value)

Create an expression AST node that references a literal value. Upon string coercion, an appropriate SQL value will be produced. For example, string literals will be properly quoted and JavaScript Date objects that match an exact UTC date will be converted to the SQL Date definitions. The supported primitive types are: boolean, null, number, string, regexp, and Date (maps to SQL Date or Timestamp depending on the value).

sql
sql`...`

A template tag for arbitrary SQL expressions that do not require deep analysis. Creates an expression AST node with only a partially structured form consisting of unstructured text and interpolated values. Interpolated values may be strings, other SQL expressions (such as column references or operators), or Param values.

The snippet below creates a dynamic expression that adds a Param value to a column. Contained column references can be extracted using the collectColumns method. Contained Param values can be extracted using the collectParams method.

const param = Param.value(5);
sql`${column("foo")} + ${param}`
SQL expressions may be nested, in which case all nested column dependencies and parameter updates are still extractable via the collection visitors.

Operators
SQL comparison operator expressions.

and
and(...clauses)

Returns an expression for the logical AND of the provided clauses. The clauses array will be flattened and any null entries will be ignored.

or
or(...clauses)

Returns an expression for the logical OR of the provided clauses. The clauses array will be flattened and any null entries will be ignored.

not
not(expression)

Returns an expression for the logical NOT of the provided expression.

eq
eq(a, b)

Returns an expression testing if expression a is equal to expression b. In SQL semantics, two NULL values are not considered equal. Use isNotDistinct to compare values with NULL equality.

neq
neq(a, b)

Returns an expression testing if expression a is not equal to expression b. In SQL semantics, two NULL values are not considered equal. Use isDistinct to compare values with NULL equality.

lt
lt(a, b)

Returns an expression testing if expression a is less than expression b.

gt
gt(a, b)

Returns an expression testing if expression a is greater than expression b.

lte
lte(a, b)

Returns an expression testing if expression a is less than or equal to expression b.

gte
gte(a, b)

Returns an expression testing if expression a is greater than or equal to expression b.

isNull
isNull(expression)

Returns an expression testing if the input expression is a NULL value.

isNotNull
isNotNull(expression)

Returns an expression testing if the input expression is not a NULL value.

isDistinct
isDistinct(a, b)

Returns an expression testing if expression a is distinct from expression b. Unlike normal SQL equality checks, here NULL values are not considered distinct.

isNotDistinct
Returns an expression testing if expression a is not distinct from expression b. Unlike normal SQL equality checks, here NULL values are not considered distinct.

isBetween
isBetween(expression, [lo, hi])

Returns an expression testing if the input expression lies between the values lo and hi, provided as a two-element array. Equivalent to lo <= expression AND expression <= hi.

isNotBetween
isNotBetween(expression, [lo, hi])

Returns an expression testing if the input expression does not lie between the values lo and hi, provided as a two-element array. Equivalent to NOT(lo <= expression AND expression <= hi).

isIn
isIn(expression, values)

Returns an expression testing if the input expression matches any of the entries in the values array. Maps to expression IN (...values).

listContains
listContains(expression, value)

Returns an expression testing if the input value exists in the expression list. Maps to list_contains(expression, value).

listHasAny
listHasAny(expression, values)

Returns an expression testing if any of the input values exist in the expression list. Maps to list_has_any(expression, values).

listHasAll
listHasAll(expression, values)

Returns an expression testing if all the input values exist in the expression list. Maps to list_has_all(expression, values).

unnest
unnest(expression)

Returns an expression that unnests the expression list or struct. Maps to UNNEST(expression).

Date Functions
SQL date function expressions.

epoch_ms
epoch_ms(expression)

Returns a function expression that maps the input date or datetime expression to the number of milliseconds since the UNIX epoch (Jan 1, 1970 UTC).

dateBin
dateBin(expression, interval, steps = 1)

Returns a function expression that bins the input date or datetime expression to the given date/time interval such as hour, day, or month. The optional steps argument indicates an integer bin step size in terms of intervals, such as every 1 day or every 2 days.

dateMonth
dateMonth(expression)

Returns a function expression that maps the input date or datetime expression to the first day of the corresponding month in the year 2012. This function is useful to map dates across varied years to a shared frame for cyclic comparison while maintaining a temporal data type. The year 2012 is a convenient target as it is a leap year that starts on a Sunday.

dateMonthDay
dateMonthDay(expression)

Returns a function expression that maps the input date or datetime expression to the corresponding month and day in the year 2012. This function is useful to map dates across varied years to a shared frame for cyclic comparison while maintaining a temporal data type. The year 2012 is a convenient target as it is a leap year that starts on a Sunday.

dateDay
dateDay(expression)

Returns a function expression that maps the input date or datetime expression to the corresponding day of the month in January 2012. This function is useful to map dates across varied years to a shared frame for cyclic comparison while maintaining a temporal data type. The year 2012 is a convenient target as it is a leap year that starts on a Sunday.

Aggregate Functions
SQL aggregate function expressions.

AggregateNode
The AggregateNode class represents a SQL AST node for an aggregate function call. Users should not need to instantiate AggregateNode instances directly, but instead should use aggregate function methods such as count(), sum(), etc.

distinct
AggregateNode.distinct()

Returns a new AggregateNode instance that applies the aggregation over distinct values only.

where
AggregateNode.where(filter)

Returns a new AggregateNode instance filtered according to a Boolean-valied filter expression.

window
AggregateNode.window()

Returns a windowed version of this aggregate function as a new WindowNode instance.

partitionby
AggregateNode.partitionby(...expressions)

Provide one or more expressions by which to partition a windowed version of this aggregate function and returns a new WindowNode instance.

orderby
AggregateNode.orderby(...expressions)

Provide one or more expressions by which to sort a windowed version of this aggregate function and returns a new WindowNode instance.

rows
AggregateNode.rows(expression)

Provide a window "rows" frame specification as an array or array-valued expression and returns a windowed version of this aggregate function as a new WindowNode instance. A "rows" window frame is insensitive to peer rows (those that are tied according to the orderby criteria). The frame expression should evaluate to a two-element array indicating the number of preceding or following rows. A zero value (0) indicates the current row. A non-finite value (including null and undefined) indicates either unbounded preceding row (for the first array entry) or unbounded following rows (for the second array entry).

range
AggregateNode.range(expression)

Provide a window "range" frame specification as an array or array-valued expression and returns a windowed version of this aggregate function as a new WindowNode instance. A "range" window grows to include peer rows (those that are tied according to the orderby criteria). The frame expression should evaluate to a two-element array indicating the number of preceding or following rows. A zero value (0) indicates the current row. A non-finite value (including null and undefined) indicates either unbounded preceding row (for the first array entry) or unbounded following rows (for the second array entry).

count
count()

Create an aggregate function that counts the number of records.

avg
avg(expression)

Create an aggregate function that calculates the average of the input expression.

mad
mad(expression)

Create an aggregate function that calculates the median absolute deviation (MAD) of the input expression.

max
max(expression)

Create an aggregate function that calculates the maximum of the input expression.

min
min(expression)

Create an aggregate function that calculates the minimum of the input expression.

sum
sum(expression)

Create an aggregate function that calculates the sum of the input expression.

product
product(expression)

Create an aggregate function that calculates the product of the input expression.

geomean
geomean(expression)

Create an aggregate function that calculates the geometric mean of the input expression.

median
median(expression)

Create an aggregate function that calculates the average of the input expression.

quantile
quantile(expression, p)

Create an aggregate function that calculates the p-th quantile of the input expression. For example, p = 0.5 computes the median, while 0.25 computes the lower inter-quartile range boundary.

mode
mode(expression)

Create an aggregate function that calculates the mode of the input expression.

variance
variance(expression)

Create an aggregate function that calculates the sample variance of the input expression.

stddev
stddev(expression)

Create an aggregate function that calculates the sample standard deviation of the input expression.

skewness
skewness(expression)

Create an aggregate function that calculates the skewness of the input expression.

kurtosis
kurtosis(expression)

Create an aggregate function that calculates the kurtosis of the input expression.

entropy
entropy(expression)

Create an aggregate function that calculates the entropy of the input expression.

varPop
varPop(expression)

Create an aggregate function that calculates the population variance of the input expression.

stddevPop
stddevPop(expression)

Create an aggregate function that calculates the population standard deviation of the input expression.

corr
corr(a, b)

Create an aggregate function that calculates the correlation between the input expressions a and b.

covarPop
covarPop(a, b)

Create an aggregate function that calculates the population covariance between the input expressions a and b.

regrIntercept
regrIntercept(y, x)

Create an aggregate function that returns the intercept of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrSlope
regrSlope(y, x)

Create an aggregate function that returns the slope of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrCount
regrCount(y, x)

Create an aggregate function that returns the count of non-null values used to fit the linear regression model that predicts the target expression y based on the predictor expression x.

regrR2
regrR2(y, x)

Create an aggregate function that returns the R^2 value of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrSXX
regrSXX(y, x)

Create an aggregate function that returns the SXX value (regrCount(y, x) \* varPop(x)) of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrSYY
regrSYY(y, x)

Create an aggregate function that returns the SYY value (regrCount(y, x) \* varPop(y)) of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrSXY
regrSXY(y, x)

Create an aggregate function that returns the SXY (regrCount(y, x) \* covarPop(y, x)) value of the fitted linear regression model that predicts the target expression y based on the predictor expression x.

regrAvgX
regrAvgX(y, x)

Create an aggregate function that returns the average x value of the data used to fit the linear regression model that predicts the target expression y based on the predictor expression x.

regrAvgY
regrAvgY(y, x)

Create an aggregate function that returns the average x value of the data used to fit the linear regression model that predicts the target expression y based on the predictor expression x.

first
first(expression)

Create an aggregate function that calculates the first observed value of the input expression.

last
last(expression)

Create an aggregate function that calculates the last observed value of the input expression.

argmax
argmax(arg, value)

Create an aggregate function that returns the expression arg corresponding to the maximum value of the expression value.

argmin
argmin(arg, value)

Create an aggregate function that returns the expression arg corresponding to the minimum value of the expression value.

stringAgg
stringAgg(expression)

Create an aggregate function that returns the string concatenation of the input expression values.

arrayAgg
arrayAgg(expression)

Create an aggregate function that returns a list of the input expression values.

Window Functions
SQL window function expressions.

WindowNode
The WindowNode class represents a window function. It includes a non-null window property indicating a window expression. Users should not need to instantiate WindowNode instances directly, but instead should use window function methods such as row_number(), lag(), etc.

over
WindowNode.over(name)

Provide the name of a window definition for this function and returns a new WindowNode instance. The window should be defined separately in an issued query, for example using the Query.window method.

partitionby
WindowNode.partitionby(...expressions)

Provide one or more expressions by which to partition this window function and returns a new WindowFunction instance.

orderby
WindowNode.orderby(...expressions)

Provide one or more expressions by which to sort this window function and returns a new WindowFunction instance.

rows
WindowNode.rows(expression)

Provide a window "rows" frame specification as an array or array-valued expression and returns a new WindowNode instance. A "rows" window frame is insensitive to peer rows (those that are tied according to the orderby criteria). The frame expression should evaluate to a two-element array indicating the number of preceding or following rows. A zero value (0) indicates the current row. A non-finite value (including null and undefined) indicates either unbounded preceding row (for the first array entry) or unbounded following rows (for the second array entry).

range
WindowNode.range(expression)

Provide a window "range" frame specification as an array or array-valued expression and returns a new WindowNode instance. A "range" window grows to include peer rows (those that are tied according to the orderby criteria). The frame expression should evaluate to a two-element array indicating the number of preceding or following rows. A zero value (0) indicates the current row. A non-finite value (including null and undefined) indicates either unbounded preceding row (for the first array entry) or unbounded following rows (for the second array entry).

row_number
row_number()

Create a window function that returns the number of the current row within the partition, counting from 1.

rank
rank()

Create a window function that returns the rank of the current row with gaps. This is the same as the row_number of its first peer.

dense_rank
dense_rank()

Create a window function that returns the rank of the current row without gaps, The function counts peer groups.

percent_rank
percent_rank()

Create a window function that returns the relative rank of the current row. Equal to (rank() - 1) / (total partition rows - 1).

cume_dist
cume_dist()

Create a window function that returns the cumulative distribution. (number of preceding or peer partition rows) / total partition rows.

ntile
ntile(num_buckets)

Create a window function that r an integer ranging from 1 to num_buckets, dividing the partition as equally as possible.

lag
lag(expression, offset, default)

Create a window function that returns the expression evaluated at the row that is offset rows before the current row within the partition. If there is no such row, instead return default (which must be of the same type as the expression). Both offset and default are evaluated with respect to the current row. If omitted, offset defaults to 1 and default to null.

lead
lead(expression, offset, default)

Create a window function that returns the expression evaluated at the row that is offset rows after the current row within the partition. If there is no such row, instead return default (which must be of the same type as the expression). Both offset and default are evaluated with respect to the current row. If omitted, offset defaults to 1 and default to null.

first_value
first_value(expression)

Create a window function that returns the expression evaluated at the row that is the first row of the window frame.

last_value
last_value(expression)

Create a window function that returns the expression evaluated at the row that is the last row of the window frame.

nth_value
nth_value(expression, nth)

Create a window function that returns the expression evaluated at the nth row of the window frame (counting from 1), or null if no such row.
