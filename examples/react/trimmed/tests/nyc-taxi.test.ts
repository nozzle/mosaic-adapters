import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';

const init = getInit('nyc-taxi');

test.describe('nyc-taxi page', () => {
  test('has the correct header', async ({ page }) => {
    await init(page);

    const heading = page.getByRole('heading', {
      level: 2,
      name: 'NYC Taxi Dashboard',
    });
    await expect(heading).toBeVisible();
  });
});
