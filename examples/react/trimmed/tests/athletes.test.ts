import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';

const init = getInit('athletes');

test.describe('athletes page', () => {
  test('has the correct header', async ({ page }) => {
    await init(page);

    const heading = page.getByRole('heading', {
      level: 2,
      name: 'Athletes Dashboard',
    });
    await expect(heading).toBeVisible();
  });

  test('grouped table section is visible', async ({ page }) => {
    await init(page);
    const heading = page.getByRole('heading', {
      level: 4,
      name: /Grouped Table/,
    });
    await expect(heading).toBeVisible();
  });

  test('grouped table renders country data', async ({ page }) => {
    await init(page);
    // Wait for the "N countries" footer to appear (indicates data loaded)
    const footer = page.getByText(/\d+ countries/);
    await expect(footer).toBeVisible({ timeout: 15000 });
    // Verify expand indicators are present
    const expandIndicator = page.locator('text=▶').first();
    await expect(expandIndicator).toBeVisible();
  });
});
