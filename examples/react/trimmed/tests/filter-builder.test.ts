import { expect, test } from '@playwright/test';

test.describe('filter-builder page', () => {
  test('page and widget filters visibly update downstream tables', async ({
    page,
  }) => {
    await page.goto('/?dashboard=filter-builder', {
      waitUntil: 'networkidle',
    });

    await expect(page.getByText('Page Filter Scope')).toBeVisible();

    const pageSummary = page.getByTestId('page-roster-summary');
    const widgetSummary = page.getByTestId('widget-medals-summary');

    await expect(pageSummary).toContainText('Visible rows:');
    await expect(widgetSummary).toContainText('Visible rows:');

    const pageBefore = await pageSummary.textContent();
    await page.getByLabel('Sport').selectOption('basketball');
    await expect(pageSummary).not.toHaveText(pageBefore ?? '');

    const widgetBefore = await widgetSummary.textContent();
    await page.getByLabel('Gender').selectOption('female');
    await expect(widgetSummary).not.toHaveText(widgetBefore ?? '');
  });
});
