import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The nozzle_test parquet is a fixed dataset (203,556 PAA rows: 2,681
// phrases, 4,779 questions, 7 days, 2 devices), so the suite asserts exact
// SQL-computed values — including the legacy suite's dataset literals
// ('gaz stove' / 'gasoline stove' share the top search volume).
const TOTAL_QUESTIONS = '4,779';
const TOTAL_ROWS = '203,556';

const summaryTableIds = ['phrase', 'question', 'domain', 'url'] as const;

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/');
  // First paint waits on DuckDB-WASM instantiation + the proxied parquet.
  await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS, {
    timeout: 90_000,
  });
}

function summaryRows(page: Page, id: string, expanded = false): Locator {
  return page
    .getByTestId(`summary-table-${id}${expanded ? '-expanded' : ''}`)
    .locator('tbody tr');
}

async function readQuestionsKpi(page: Page): Promise<number> {
  const text = (await page.getByTestId('kpi-questions').textContent()) ?? '0';
  return Number(text.replaceAll(',', '').trim());
}

test.describe('nozzle-paa dashboard', () => {
  test('renders the header, KPIs, and initial summary tables', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Nozzle PAA Report' }),
    ).toBeVisible();
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2,681');
    await expect(page.getByTestId('kpi-days')).toHaveText('7');
    await expect(page.getByTestId('kpi-devices')).toHaveText('2');

    // No stray selection strips or undefined values on a clean load.
    await expect(page.getByText(/^Selected \(\d+\)$/)).toHaveCount(0);
    await expect(page.getByText('undefined')).toHaveCount(0);

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

  test('one batched sparkline client feeds the phrase table', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const phraseCard = page.getByTestId('summary-table-phrase');
    await expect(phraseCard.locator('[data-testid="sparkline"]')).toHaveCount(
      10,
      { timeout: 30_000 },
    );
  });

  test('keeps narrowed summary selections visible and removable outside the table body', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await summaryRows(page, 'phrase').nth(0).click();
    await summaryRows(page, 'phrase').nth(1).click();

    // Row highlight: with a selection active, non-matching rows dim.
    await expect(
      page.getByTestId('summary-table-phrase').locator('tbody tr.opacity-30'),
    ).toHaveCount(8);

    // Let the keyword selection cascade land before touching the question
    // table, so its top row reflects the narrowed subset.
    await expect.poll(() => readQuestionsKpi(page)).toBeLessThan(4_779);
    await summaryRows(page, 'question').nth(0).click();

    await expect(page.getByText('Selected Keyword:').first()).toBeVisible();
    await expect(page.getByText('Selected Question:').first()).toBeVisible();

    // The question selection narrows the keyword table (peer cascade) so a
    // selected keyword can leave the visible page…
    await expect(
      summaryRows(page, 'phrase').filter({ hasText: 'gaz stove' }),
    ).toHaveCount(0);

    // …while its in-widget chip stays visible and removable.
    const hiddenSelectionChip = page.getByRole('button', {
      name: 'Remove Keyword Phrase selection gaz stove',
    });
    await expect(hiddenSelectionChip).toBeVisible();
    await hiddenSelectionChip.click();

    await expect(hiddenSelectionChip).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Remove Keyword Phrase selection gasoline stove',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Clear Keyword Phrase selections' }),
    ).toBeVisible();
  });

  test('preserves an existing summary selection when that table is enlarged', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await summaryRows(page, 'domain').nth(0).click();
    await expect(
      page
        .getByTestId('summary-table-domain')
        .getByRole('button', { name: /Remove Domain selection / }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Enlarge Domain table' }).click();

    await expect(
      page.getByTestId('summary-table-domain-placeholder'),
    ).toBeVisible();
    const expandedCard = page.getByTestId('summary-table-domain-expanded');
    await expect(expandedCard).toBeVisible();
    await expect(
      expandedCard.getByRole('button', { name: /Remove Domain selection / }),
    ).toBeVisible();
  });

  test('preserves selections made while enlarged after returning the table to the grid', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await page.getByRole('button', { name: 'Enlarge Domain table' }).click();

    const expandedCard = page.getByTestId('summary-table-domain-expanded');
    await summaryRows(page, 'domain', true).nth(0).click();
    await expect(
      expandedCard.getByRole('button', { name: /Remove Domain selection / }),
    ).toBeVisible();

    await expandedCard
      .getByRole('button', { name: 'Return Domain table to grid' })
      .click();

    const gridCard = page.getByTestId('summary-table-domain');
    await expect(gridCard).toBeVisible();
    await expect(
      page.getByTestId('summary-table-domain-placeholder'),
    ).toHaveCount(0);
    await expect(
      gridCard.getByRole('button', { name: /Remove Domain selection / }),
    ).toBeVisible();
  });

  test('keeps shared question selection state correct through enlarge, update, and clear', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const initialKpi = await readQuestionsKpi(page);

    await summaryRows(page, 'question').nth(0).click();
    await summaryRows(page, 'question').nth(1).click();

    await expect.poll(() => readQuestionsKpi(page)).toBe(2);
    await expect(page.getByText('Selected Question:')).toHaveCount(2);

    await page
      .getByRole('button', { name: 'Enlarge PAA Questions table' })
      .click();

    const expandedCard = page.getByTestId('summary-table-question-expanded');
    await summaryRows(page, 'question', true).nth(2).click();

    await expect.poll(() => readQuestionsKpi(page)).toBe(3);
    await expect(page.getByText('Selected Question:')).toHaveCount(3);

    await expandedCard
      .getByRole('button', { name: 'Return PAA Questions table to grid' })
      .click();

    const restoredCard = page.getByTestId('summary-table-question');
    await restoredCard
      .getByRole('button', { name: 'Clear PAA Questions selections' })
      .click();

    await expect.poll(() => readQuestionsKpi(page)).toBe(initialKpi);
    await expect(page.getByText('Selected Question:')).toHaveCount(0);
    await expect(restoredCard.locator('tbody tr.opacity-30')).toHaveCount(0);
    await expect(
      restoredCard.getByRole('button', {
        name: 'Clear PAA Questions selections',
      }),
    ).toHaveCount(0);
  });

  test('the question card metric filter routes HAVING to its own table and a membership subquery to its siblings', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await page.getByTestId('metric-filter-question-value').fill('5000');
    await page.getByTestId('metric-filter-question-apply').check();

    // Exactly 3 questions appear on more than 5,000 SERPs; the membership
    // subquery narrows the KPI (and every sibling) to the same subset.
    await expect(page.getByTestId('kpi-questions')).toHaveText('3');
    await expect(summaryRows(page, 'question')).toHaveCount(3);
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'SERP Appears:> 5000',
    );

    // Removing the chip un-applies the widget filter (checkbox included).
    await page
      .getByRole('button', { name: /Remove filter SERP Appears/ })
      .click();
    await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS);
    await expect(
      page.getByTestId('metric-filter-question-apply'),
    ).not.toBeChecked();
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('every summary card has a metric-threshold filter on its computed column', async ({
    page,
  }) => {
    await gotoDashboard(page);

    for (const id of summaryTableIds) {
      await expect(page.getByTestId(`metric-filter-${id}`)).toBeVisible();
    }

    // Phrase card thresholds its max(search_volume) metric: only the two
    // 90,500-volume phrases survive, and the membership subquery narrows
    // the phrase KPI to the same subset.
    await page.getByTestId('metric-filter-phrase-value').fill('50000');
    await page.getByTestId('metric-filter-phrase-apply').check();
    await expect(summaryRows(page, 'phrase')).toHaveCount(2);
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2');
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Search Vol:> 50000',
    );
    await page
      .getByRole('button', { name: /Remove filter Search Vol/ })
      .click();
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2,681');

    // Domain card thresholds count(*): only reddit.com (17,902) and
    // youtube.com (11,045) exceed 10,000 answers, and the detail table
    // narrows to exactly their combined rows.
    await page.getByTestId('metric-filter-domain-value').fill('10000');
    await page.getByTestId('metric-filter-domain-apply').check();
    await expect(summaryRows(page, 'domain')).toHaveCount(2);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '28,947 rows match',
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Domain Answers:> 10000',
    );

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
  });

  test('the devices KPI is data-driven and participates in the filter context', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId('kpi-devices')).toHaveText('2');

    // Selecting one device from the facet drops the KPI to 1.
    await page.getByTestId('filter-device').locator('button').first().click();
    const firstDevice = page
      .getByTestId('filter-device')
      .getByRole('button', { name: /\(/ })
      .first();
    await expect(firstDevice).toBeVisible({ timeout: 15_000 });
    await firstDevice.click();
    await expect(page.getByTestId('kpi-devices')).toHaveText('1');

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-devices')).toHaveText('2');
  });

  test('the min-domains membership subquery filters the page and clears from the chip bar', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await page.getByTestId('question-min-domains-input').fill('4');

    // 418 questions appear on at least 4 distinct domains.
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Min Domains:≥ 4',
    );

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS);
    await expect(page.getByTestId('question-min-domains-input')).toHaveValue(
      '',
    );
  });

  test('detail column filters bridge into the page selection, and Clear All wins over TanStack state', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // Struct-path column: the ilike clause tests "related_phrase"."phrase".
    await page.getByTestId('detail-filter-paa_question').fill('coleman');
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '49,344 rows match',
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'PAA Question:coleman',
    );

    // Global reset prunes the TanStack filter state through the bridge's
    // external-clear write-back — the input empties instead of republishing.
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('detail-filter-paa_question')).toHaveValue(
      '',
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('facet dropdowns cascade counts and publish into the page', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await page.getByTestId('filter-domain').locator('button').first().click();
    const reddit = page
      .getByTestId('filter-domain')
      .getByRole('button', { name: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });

    const label = (await reddit.textContent()) ?? '';
    const count = /\(([\d,]+)\)/.exec(label)?.[1];
    if (count === undefined) {
      throw new Error(`facet option label has no count: ${label}`);
    }

    await reddit.click();
    // The facet's count equals the narrowed detail-table total exactly.
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${count} rows match`,
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Domain:reddit.com',
    );

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
  });

  test('every widget exposes the SQL it last executed', async ({ page }) => {
    await gotoDashboard(page);

    // 4 summary tables + the detail table each render a SQL footer.
    await expect(page.getByTestId('widget-sql')).toHaveCount(5);
    const first = page.getByTestId('widget-sql').first();
    await first.locator('summary').click();
    await expect(first.locator('pre')).toContainText('SELECT');
  });
});
