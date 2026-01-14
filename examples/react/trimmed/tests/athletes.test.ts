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
});
