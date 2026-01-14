import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';

const init = getInit('athletes-simple');

test.describe('athletes-simple page', () => {
  test('has the correct header', async ({ page }) => {
    await init(page);

    const heading = page.getByRole('heading', {
      level: 2,
      name: 'Athletes (No Helper)',
    });
    await expect(heading).toBeVisible();
  });
});
