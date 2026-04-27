import { expect, test } from '@playwright/test';
import { getInit } from './utils/init';
import type { Page } from '@playwright/test';

const init = getInit('nozzle-paa');

test.describe('nozzle-paa page', () => {
  const summaryTableIds = ['phrase', 'question', 'domain', 'url'] as const;

  const readUniqueQuestionsKpi = async (page: Page) => {
    const card = page.getByText('# of Unique Questions').locator('xpath=..');
    const valueText =
      (await card.locator(':scope > div').nth(1).textContent()) ?? '0';

    return Number(valueText.replaceAll(',', '').trim());
  };

  test('has the correct header', async ({ page }) => {
    await init(page);

    const heading = page.getByRole('heading', {
      level: 2,
      name: 'Nozzle PAA Report',
    });
    await expect(heading).toBeVisible();
    await expect(page.getByText(/^Selected \(\d+\)$/)).toHaveCount(0);
    await expect(page.getByText('undefined')).toHaveCount(0);
  });

  test('renders initial summary table rows', async ({ page }) => {
    await init(page);

    for (const summaryId of summaryTableIds) {
      const card = page.getByTestId(`summary-table-${summaryId}`);

      await expect
        .poll(async () => {
          const bodyText = (await card.locator('tbody').textContent()) ?? '';
          const rowCount = await card.locator('tbody tr').count();

          return rowCount > 0 && !bodyText.includes('No results.');
        })
        .toBe(true);
      await expect(card.locator('tbody tr.opacity-30')).toHaveCount(0);
    }
  });

  test('keeps narrowed summary selections visible and removable outside the table body', async ({
    page,
  }) => {
    await init(page);

    const keywordTable = page.locator('table').nth(0);
    const questionTable = page.locator('table').nth(1);

    await keywordTable.locator('tbody tr').nth(0).click();
    await keywordTable.locator('tbody tr').nth(1).click();

    await questionTable.locator('tbody tr').nth(0).click();

    await expect(page.getByText('unknown:')).toHaveCount(0);
    await expect(page.getByText('Selected Keyword:').first()).toBeVisible();
    await expect(page.getByText('Selected Question:').first()).toBeVisible();

    await expect(
      keywordTable.locator('tbody tr').filter({ hasText: 'gaz stove' }),
    ).toHaveCount(0);

    const hiddenSelectionButton = page.getByRole('button', {
      name: 'Remove Keyword Phrase selection gaz stove',
    });
    await expect(hiddenSelectionButton).toBeVisible();

    await hiddenSelectionButton.click();

    await expect(hiddenSelectionButton).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Remove Keyword Phrase selection gasoline stove',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Clear Keyword Phrase selections',
      }),
    ).toBeVisible();
  });

  test('preserves an existing summary selection when that table is enlarged', async ({
    page,
  }) => {
    await init(page);

    const domainCard = page.getByTestId('summary-table-domain');
    await domainCard.locator('table tbody tr').nth(0).click();

    await expect(
      domainCard.getByRole('button', {
        name: /Remove Domain selection /,
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Enlarge Domain table' }).click();

    const expandedDomainCard = page.getByTestId(
      'summary-table-domain-expanded',
    );
    await expect(
      page.getByTestId('summary-table-domain-placeholder'),
    ).toBeVisible();
    await expect(expandedDomainCard).toBeVisible();
    await expect(
      expandedDomainCard.getByRole('button', {
        name: /Remove Domain selection /,
      }),
    ).toBeVisible();
  });

  test('preserves selections made while enlarged after returning the table to the grid', async ({
    page,
  }) => {
    await init(page);

    await page.getByRole('button', { name: 'Enlarge Domain table' }).click();

    const expandedDomainCard = page.getByTestId(
      'summary-table-domain-expanded',
    );
    await expandedDomainCard.locator('table tbody tr').nth(0).click();

    await expect(
      expandedDomainCard.getByRole('button', {
        name: /Remove Domain selection /,
      }),
    ).toBeVisible();

    await expandedDomainCard
      .getByRole('button', { name: 'Return Domain table to grid' })
      .click();

    const gridDomainCard = page.getByTestId('summary-table-domain');
    await expect(gridDomainCard).toBeVisible();
    await expect(
      page.getByTestId('summary-table-domain-placeholder'),
    ).toHaveCount(0);
    await expect(
      gridDomainCard.getByRole('button', {
        name: /Remove Domain selection /,
      }),
    ).toBeVisible();
  });

  test('keeps shared question selection state correct through enlarge, update, and clear', async ({
    page,
  }) => {
    await init(page);

    const initialKpi = await readUniqueQuestionsKpi(page);
    const questionCard = page.getByTestId('summary-table-question');

    await questionCard.locator('table tbody tr').nth(0).click();
    await questionCard.locator('table tbody tr').nth(1).click();

    await expect.poll(() => readUniqueQuestionsKpi(page)).toBe(2);
    await expect(page.getByText('Selected Question:')).toHaveCount(2);

    await page
      .getByRole('button', { name: 'Enlarge PAA Questions table' })
      .click();

    const expandedQuestionCard = page.getByTestId(
      'summary-table-question-expanded',
    );
    await expandedQuestionCard.locator('table tbody tr').nth(2).click();

    await expect.poll(() => readUniqueQuestionsKpi(page)).toBe(3);
    await expect(page.getByText('Selected Question:')).toHaveCount(3);

    await expandedQuestionCard
      .getByRole('button', { name: 'Return PAA Questions table to grid' })
      .click();

    const restoredQuestionCard = page.getByTestId('summary-table-question');
    await restoredQuestionCard
      .getByRole('button', { name: 'Clear PAA Questions selections' })
      .click();

    await expect.poll(() => readUniqueQuestionsKpi(page)).toBe(initialKpi);
    await expect(page.getByText('Selected Question:')).toHaveCount(0);
    await expect(
      restoredQuestionCard.locator('tbody tr.opacity-30'),
    ).toHaveCount(0);
    await expect(
      restoredQuestionCard.getByRole('button', {
        name: 'Clear PAA Questions selections',
      }),
    ).toHaveCount(0);
  });
});
