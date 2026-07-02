import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The athletes parquet is a fixed dataset (11,538 Rio 2016 athletes), so the
// suite asserts exact SQL-computed values: 666/655/704 total gold/silver/
// bronze medals, one athlete matching 'phelps', 3,342 athletes weighing
// 60–70kg, weights spanning 31–170kg.
const TOTAL = '11,538';

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/');
  // First paint waits on DuckDB-WASM instantiation + the parquet download.
  await expect(page.getByTestId('kpi-athletes')).toHaveText(TOTAL, {
    timeout: 60_000,
  });
  await expect(tableRows(page)).toHaveCount(25);
}

function tableRows(page: Page): Locator {
  return page.locator('[data-testid="athletes-table-body"] tr');
}

function scatterDots(page: Page): Locator {
  return page.locator('[data-testid="scatter-plot"] svg circle');
}

async function firstRowName(page: Page): Promise<string> {
  return tableRows(page).first().locator('td').first().innerText();
}

test('loads the dashboard: table, KPIs, and vgplot scatter from one DuckDB', async ({
  page,
}) => {
  await gotoDashboard(page);

  await expect(page.getByTestId('total-rows')).toHaveText(
    `${TOTAL} athletes match`,
  );
  await expect(page.getByTestId('kpi-medals')).toHaveText('666'); // sum(gold)
  // The dot mark renders one circle per (weight, height) row.
  expect(await scatterDots(page).count()).toBeGreaterThan(1_000);
});

test('sorting executes in SQL across the whole dataset', async ({ page }) => {
  await gotoDashboard(page);

  // The dataset's global min/max weights can only appear on page one if the
  // ORDER BY runs in SQL — getCoreRowModel never sorts. TanStack's default
  // toggle order for numeric columns is desc first.
  await page.getByTestId('sort-weight').click();
  await expect(tableRows(page).first().locator('td').nth(5)).toHaveText(
    '170kg',
  );

  await page.getByTestId('sort-weight').click();
  await expect(tableRows(page).first().locator('td').nth(5)).toHaveText('31kg');
});

test('pagination executes in SQL as LIMIT/OFFSET', async ({ page }) => {
  await gotoDashboard(page);

  const pageOneFirst = await firstRowName(page);
  await expect(page.getByTestId('page-label')).toHaveText('Page 1 of 462');

  const firstNameCell = tableRows(page).first().locator('td').first();
  await page.getByTestId('page-next').click();
  await expect(page.getByTestId('page-label')).toHaveText('Page 2 of 462');
  await expect(firstNameCell).not.toHaveText(pageOneFirst);
  await expect(tableRows(page)).toHaveCount(25);

  await page.getByTestId('page-prev').click();
  await expect(page.getByTestId('page-label')).toHaveText('Page 1 of 462');
  await expect(firstNameCell).toHaveText(pageOneFirst);
});

test('bridge-published column filters drive the table, KPIs, and the vgplot scatter', async ({
  page,
}) => {
  await gotoDashboard(page);

  // Text filter → ilike clause on $page: every consumer re-queries.
  await page.getByTestId('filter-name').fill('phelps');
  await expect(page.getByTestId('total-rows')).toHaveText('1 athletes match');
  await expect(tableRows(page)).toHaveCount(1);
  await expect(tableRows(page).first()).toContainText('Michael Phelps');
  await expect(page.getByTestId('kpi-athletes')).toHaveText('1');
  await expect(page.getByTestId('kpi-medals')).toHaveText('5');
  await expect(scatterDots(page)).toHaveCount(1);

  // Clearing the filter removes the clause and unfilters everything.
  await page.getByTestId('filter-name').fill('');
  await expect(page.getByTestId('kpi-athletes')).toHaveText(TOTAL);

  // Range filter → interval clause.
  await page.getByTestId('filter-weight-min').fill('60');
  await page.getByTestId('filter-weight-max').fill('70');
  await expect(page.getByTestId('total-rows')).toHaveText(
    '3,342 athletes match',
  );
  await expect(page.getByTestId('kpi-athletes')).toHaveText('3,342');
});

test('brushing the scatter filters the table and KPIs, but not the scatter itself', async ({
  page,
}) => {
  await gotoDashboard(page);

  const dotsBefore = await scatterDots(page).count();
  const box = await page
    .locator('[data-testid="scatter-plot"] svg')
    .boundingBox();
  if (box === null) {
    throw new Error('scatter svg not found');
  }

  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, {
    steps: 10,
  });
  await page.mouse.up();

  // The brush clause filters the table and KPI clients…
  await expect(page.getByTestId('kpi-athletes')).not.toHaveText(TOTAL);
  await expect(page.getByTestId('total-rows')).not.toHaveText(
    `${TOTAL} athletes match`,
  );
  const filtered = Number(
    (await page.getByTestId('kpi-athletes').innerText()).replaceAll(',', ''),
  );
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(11_538);

  // …while crossfilter self-exclusion keeps the scatter itself unfiltered.
  expect(await scatterDots(page).count()).toBe(dotsBefore);
});

test('a Param change re-queries the KPI values client', async ({ page }) => {
  await gotoDashboard(page);

  await expect(page.getByTestId('kpi-medals')).toHaveText('666'); // gold
  await page.getByTestId('metric-select').selectOption('silver');
  await expect(page.getByTestId('kpi-medals')).toHaveText('655');
  await page.getByTestId('metric-select').selectOption('bronze');
  await expect(page.getByTestId('kpi-medals')).toHaveText('704');
});

test('row clicks publish picked athletes', async ({ page }) => {
  await gotoDashboard(page);

  await tableRows(page).first().click();
  await expect(page.getByTestId('picked-strip')).toContainText('Picked (1):');

  await tableRows(page).nth(1).click();
  await expect(page.getByTestId('picked-strip')).toContainText('Picked (2):');

  await page.getByTestId('picked-clear').click();
  await expect(page.getByTestId('picked-strip')).toHaveCount(0);
});

test('the sport facet is data-driven, cascades KPIs, and never filters itself', async ({
  page,
}) => {
  await gotoDashboard(page);

  const facet = page.getByTestId('sport-facet');
  const options = facet.locator('option');
  // Data-driven options: every sport in the dataset plus "All sports" —
  // strictly more than the 7 hardcoded sports this select replaces.
  await expect
    .poll(async () => options.count(), { timeout: 15_000 })
    .toBeGreaterThan(8);

  // Each option label carries its cascading count; selecting a sport must
  // filter every other client to exactly that count.
  const label = await options.nth(1).innerText();
  const match = /^(.+) \(([\d,]+)\)$/.exec(label.trim());
  if (match === null) {
    throw new Error(`facet option label has no count: ${label}`);
  }
  const [, sport, count] = match;
  const optionCountBefore = await options.count();

  await facet.selectOption(sport!);
  await expect(page.getByTestId('kpi-athletes')).toHaveText(count!);
  await expect(page.getByTestId('total-rows')).toHaveText(
    `${count} athletes match`,
  );

  // Crossfilter self-exclusion: its own clause never prunes its own options.
  await expect(options).toHaveCount(optionCountBefore);

  await facet.selectOption('');
  await expect(page.getByTestId('kpi-athletes')).toHaveText(TOTAL);
});

test('clicking a histogram bar publishes an interval clause, but never filters its own bins', async ({
  page,
}) => {
  await gotoDashboard(page);

  const bars = page.locator('[data-testid="histogram-bar"]');
  await expect
    .poll(async () => bars.count(), { timeout: 15_000 })
    .toBeGreaterThan(10);

  // Bin counts before the brush, from the client's zero-filled bins.
  const countsBefore = await bars.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-count')),
  );
  const clickIndex = countsBefore.findIndex((count) => Number(count) > 100);
  expect(clickIndex).toBeGreaterThanOrEqual(0);

  await page.getByTestId('histogram-bin').nth(clickIndex).click();

  // The interval clause filters the table and KPIs…
  await expect(page.getByTestId('kpi-athletes')).not.toHaveText(TOTAL);
  const filtered = Number(
    (await page.getByTestId('kpi-athletes').innerText()).replaceAll(',', ''),
  );
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(11_538);

  // …while crossfilter self-exclusion keeps this histogram's bins intact.
  const countsAfter = await bars.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-count')),
  );
  expect(countsAfter).toEqual(countsBefore);

  // Clicking the selected bar again clears the clause.
  await page.getByTestId('histogram-bin').nth(clickIndex).click();
  await expect(page.getByTestId('kpi-athletes')).toHaveText(TOTAL);
});

test('one batched sparkline client feeds every table cell', async ({
  page,
}) => {
  await gotoDashboard(page);

  // Every rendered row gets a sparkline from the shared batched series.
  await expect(
    tableRows(page).first().locator('[data-testid="sparkline"]'),
  ).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('[data-testid="sparkline"]')).toHaveCount(25);
});

test('a non-TanStack $page narrowing while paginated deep clamps the page index instead of stranding the table', async ({
  page,
}) => {
  await gotoDashboard(page);

  // Pick the sparsest sport from the facet's own cascading counts, so the
  // narrowing is dataset-exact instead of pixel-dependent.
  const facet = page.getByTestId('sport-facet');
  const options = facet.locator('option');
  await expect
    .poll(async () => options.count(), { timeout: 15_000 })
    .toBeGreaterThan(8);
  const labels = await options.allInnerTexts();
  const sports = labels
    .map((label) => /^(.+) \(([\d,]+)\)$/.exec(label.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      sport: match[1]!,
      count: Number(match[2]!.replaceAll(',', '')),
    }));
  const smallest = sports.reduce((a, b) => (b.count < a.count ? b : a));
  const lastPage = Math.max(1, Math.ceil(smallest.count / 25));
  const startPage = lastPage + 2;

  // Paginate past the narrowed set's last page first — facet selects (like
  // vgplot brushes) publish straight into $page with no TanStack state
  // handler to reset pagination.
  for (let i = 1; i < startPage; i += 1) {
    await page.getByTestId('page-next').click();
  }
  await expect(page.getByTestId('page-label')).toHaveText(
    `Page ${startPage} of 462`,
  );

  await facet.selectOption(smallest.sport);
  await expect(page.getByTestId('total-rows')).toHaveText(
    `${smallest.count.toLocaleString('en-US')} athletes match`,
  );

  // The clamp lands on a populated page — never an empty one. With
  // rowCount: 'window' the stranded offset returns zero rows (total reads
  // 0), so the clamp resolves to page one.
  await expect(page.getByTestId('page-label')).toHaveText(
    `Page 1 of ${lastPage}`,
  );
  await expect.poll(async () => tableRows(page).count()).toBeGreaterThan(0);
});

test('the rollup view fetches the whole tree in one query and expands without re-querying', async ({
  page,
}) => {
  await page.goto('/?view=rollup');

  const rows = page.locator('[data-testid="rollup-row"]');
  // Grand total first: level 0, all athletes.
  await expect(rows.first()).toHaveAttribute('data-level', '0', {
    timeout: 60_000,
  });
  await expect(rows.first()).toContainText('All athletes');
  await expect(rows.first()).toContainText(TOTAL);

  // Sport subtotals are visible; leaves are not until expanded.
  const level1Before = await rows.count();
  expect(level1Before).toBeGreaterThan(8);
  await expect(
    page.locator('[data-testid="rollup-row"][data-level="2"]'),
  ).toHaveCount(0);

  await page.locator('[data-testid="rollup-toggle"]').nth(1).click();
  await expect
    .poll(async () =>
      page.locator('[data-testid="rollup-row"][data-level="2"]').count(),
    )
    .toBeGreaterThan(0);
});

test('the pivot view derives its columns from the data', async ({ page }) => {
  await page.goto('/?view=pivot');

  const columns = page.locator('[data-testid="pivot-column"]');
  // One column per gender, discovered from the result schema.
  await expect(columns).toHaveCount(2, { timeout: 60_000 });
  await expect(columns.first()).toHaveText('female');
  await expect(columns.nth(1)).toHaveText('male');

  const body = page.locator('[data-testid="pivot-table-body"] tr');
  expect(await body.count()).toBeGreaterThan(8);
});
