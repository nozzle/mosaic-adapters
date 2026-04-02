import { expect, test } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';
import { getInit } from './utils/init';

const init = getInit('filter-builder');

async function readSummary(summary: Locator) {
  await expect(summary).toContainText('Visible rows:');
  return (await summary.textContent()) ?? '';
}

async function addFilter(scope: Locator, filterLabel: string) {
  await scope.getByRole('button', { name: 'Add Filter' }).click();
  await scope
    .getByRole('button', { name: new RegExp(`^${filterLabel}`) })
    .click();
}

async function expectSummaryToChange(summary: Locator, previousText: string) {
  await expect(summary).not.toHaveText(previousText, {
    timeout: 15000,
  });
}

function getPageSummary(page: Page) {
  return page.getByTestId('page-roster-summary');
}

function getWidgetSummary(page: Page) {
  return page.getByTestId('widget-medals-summary');
}

test.describe('filter-builder page', () => {
  test('page add filter renders a new row and removing it clears the effect', async ({
    page,
  }) => {
    await init(page);

    const pageScope = page.getByTestId('page-filter-scope');
    const pageSummary = getPageSummary(page);
    const initialSummary = await readSummary(pageSummary);

    await addFilter(pageScope, 'Height');

    const heightRow = page.getByTestId('page-active-filter-height');
    await expect(heightRow).toBeVisible();

    await heightRow.getByLabel('page Height operator').selectOption('after');
    await heightRow.getByLabel('page Height start').fill('210');
    await heightRow.getByRole('button', { name: 'Apply' }).click();
    await expectSummaryToChange(pageSummary, initialSummary);

    await heightRow
      .getByRole('button', {
        name: 'Remove Height filter from page',
      })
      .click();
    await expect(page.getByTestId('page-active-filter-height')).toHaveCount(0);
    await expect(pageSummary).toHaveText(initialSummary, { timeout: 15000 });
  });

  test('widget add filter renders a local row and does not affect the page-only table', async ({
    page,
  }) => {
    await init(page);

    const widgetScope = page.getByTestId('widget-filter-scope');
    const pageSummary = getPageSummary(page);
    const widgetSummary = getWidgetSummary(page);
    const pageBefore = await readSummary(pageSummary);
    const widgetBefore = await readSummary(widgetSummary);

    await addFilter(widgetScope, 'Gold Medals');

    const goldRow = page.getByTestId('widget-active-filter-gold');
    await expect(goldRow).toBeVisible();

    await goldRow
      .getByLabel('widget Gold Medals operator')
      .selectOption('after');
    await goldRow.getByLabel('widget Gold Medals start').fill('2');
    await goldRow.getByRole('button', { name: 'Apply' }).click();

    await expectSummaryToChange(widgetSummary, widgetBefore);
    await expect(pageSummary).toHaveText(pageBefore);
  });

  test('page filters still affect both page and widget consumers', async ({
    page,
  }) => {
    await init(page);

    const pageSummary = getPageSummary(page);
    const widgetSummary = getWidgetSummary(page);
    const pageBefore = await readSummary(pageSummary);
    const widgetBefore = await readSummary(widgetSummary);
    const sportRow = page.getByTestId('page-active-filter-sport');

    await sportRow.getByLabel('page Sport value').selectOption('basketball');

    await expectSummaryToChange(pageSummary, pageBefore);
    await expectSummaryToChange(widgetSummary, widgetBefore);
  });

  test('unary operators apply without value inputs', async ({ page }) => {
    await init(page);

    const pageSummary = getPageSummary(page);
    const pageBefore = await readSummary(pageSummary);
    const nameRow = page.getByTestId('page-active-filter-name');

    await nameRow.getByLabel('page Athlete operator').selectOption('is_empty');
    await nameRow.getByRole('button', { name: 'Apply' }).click();

    await expectSummaryToChange(pageSummary, pageBefore);
    await expect(nameRow.getByLabel('page Athlete value')).toHaveCount(0);
  });

  test('facet multi-select applies through checkbox toggles', async ({
    page,
  }) => {
    await init(page);

    const pageScope = page.getByTestId('page-filter-scope');
    const pageSummary = getPageSummary(page);
    const pageBefore = await readSummary(pageSummary);

    await addFilter(pageScope, 'Nationality');

    const nationalityRow = page.getByTestId('page-active-filter-nationality');
    await expect(nationalityRow).toBeVisible();

    const firstCheckbox = nationalityRow
      .locator('input[type="checkbox"]')
      .first();
    await expect(firstCheckbox).toBeVisible({ timeout: 15000 });
    await firstCheckbox.check();

    await expectSummaryToChange(pageSummary, pageBefore);
  });
});
