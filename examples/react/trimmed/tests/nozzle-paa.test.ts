import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';

const init = getInit('nozzle-paa');

test.describe('nozzle-paa page', () => {
  test('has the correct header', async ({ page }) => {
    await init(page);

    const heading = page.getByRole('heading', {
      level: 2,
      name: 'Nozzle PAA Report',
    });
    await expect(heading).toBeVisible();
  });
});
