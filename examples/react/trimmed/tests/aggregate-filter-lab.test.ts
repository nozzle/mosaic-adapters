import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';

const init = getInit('aggregate-filter-lab');

test.describe('aggregate filter lab page', () => {
  test('shows WHERE and HAVING controls', async ({ page }) => {
    await init(page);
    const lab = page.getByTestId('aggregate-filter-lab');

    await expect(
      lab.getByRole('heading', {
        level: 2,
        name: 'Aggregate Filter Lab',
      }),
    ).toBeVisible();
    await expect(page.getByLabel('WHERE gender')).toBeVisible();
    await expect(page.getByLabel('Minimum SUM gold')).toBeVisible();
    await expect(page.getByLabel('Minimum COUNT rows')).toBeVisible();
  });

  test('HAVING threshold changes aggregate results', async ({ page }) => {
    await init(page);

    const summary = page.getByTestId('aggregate-filter-summary');
    await expect(summary).toContainText(/Visible groups: \d+/, {
      timeout: 15000,
    });
    const before = await summary.textContent();

    await page.getByLabel('Minimum SUM gold').fill('25');

    await expect(summary).not.toHaveText(before ?? '', {
      timeout: 15000,
    });
  });
});
