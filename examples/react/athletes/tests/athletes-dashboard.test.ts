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
