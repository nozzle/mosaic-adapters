import { expect, test } from '@playwright/test';

import { getInit } from './utils/init';
import type { Locator, Page } from '@playwright/test';

const initFilterBuilder = getInit('filter-builder');
const initNozzlePaa = getInit('nozzle-paa');

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

test.describe('filter-builder subquery filters', () => {
  test('declarative subquery definition filters the roster through IN (SELECT ...)', async ({
    page,
  }) => {
    await initFilterBuilder(page);

    const pageScope = page.getByTestId('page-filter-scope');
    const pageSummary = page.getByTestId('page-roster-summary');
    const widgetSummary = page.getByTestId('widget-medals-summary');
    const initialPageSummary = await readSummary(pageSummary);
    const initialWidgetSummary = await readSummary(widgetSummary);

    await addFilter(pageScope, 'Country Golds');

    const subqueryRow = page.getByTestId(
      'page-active-filter-nationality_medal_strength',
    );
    await expect(subqueryRow).toBeVisible();

    // gte is the default operator; just set the threshold and apply.
    await subqueryRow.getByLabel('page Country Golds value').fill('20');
    await subqueryRow.getByRole('button', { name: 'Apply' }).click();

    // The page scope flows into both the roster and the medal widget.
    await expectSummaryToChange(pageSummary, initialPageSummary);
    await expectSummaryToChange(widgetSummary, initialWidgetSummary);

    // Flip the operator: countries with AT MOST 20 golds — different subset.
    const filteredSummary = await readSummary(pageSummary);
    await subqueryRow
      .getByLabel('page Country Golds operator')
      .selectOption('lte');
    await subqueryRow.getByRole('button', { name: 'Apply' }).click();
    await expectSummaryToChange(pageSummary, filteredSummary);

    // Removing the filter restores the unfiltered roster.
    await subqueryRow
      .getByRole('button', { name: 'Remove Country Golds filter from page' })
      .click();
    await expect(pageSummary).toHaveText(initialPageSummary, {
      timeout: 15000,
    });
  });

  test('subquery definition reacts to sibling page filters (context rebuild)', async ({
    page,
  }) => {
    await initFilterBuilder(page);

    const pageScope = page.getByTestId('page-filter-scope');
    const pageSummary = page.getByTestId('page-roster-summary');

    await addFilter(pageScope, 'Country Golds');
    const subqueryRow = page.getByTestId(
      'page-active-filter-nationality_medal_strength',
    );
    await subqueryRow.getByLabel('page Country Golds value').fill('5');
    await subqueryRow.getByRole('button', { name: 'Apply' }).click();

    const goldsOnlySummary = await readSummary(pageSummary);

    // Constrain the sibling sport filter. The subquery factory embeds the
    // sibling context, so "5 golds" now means "5 golds in basketball" — the
    // qualifying-country set shrinks and the roster changes beyond the plain
    // AND of both filters.
    const sportRow = page.getByTestId('page-active-filter-sport');
    await sportRow.getByLabel('page Sport value').selectOption('basketball');

    await expectSummaryToChange(pageSummary, goldsOnlySummary);
  });

  test('imperative SUBQUERY-mode filter scopes only the roster table', async ({
    page,
  }) => {
    await initFilterBuilder(page);

    const pageSummary = page.getByTestId('page-roster-summary');
    const widgetSummary = page.getByTestId('widget-medals-summary');
    const initialPageSummary = await readSummary(pageSummary);
    const initialWidgetSummary = await readSummary(widgetSummary);

    const input = page.getByTestId('roster-sport-subquery-input');
    await input.fill('30');

    // Roster narrows to sports with >= 30 gold medalists...
    await expectSummaryToChange(pageSummary, initialPageSummary);
    // ...while the widget table (page + widget scopes only) is unaffected.
    await expect(widgetSummary).toHaveText(initialWidgetSummary);

    // Clearing the input restores the roster.
    await input.fill('');
    await expect(pageSummary).toHaveText(initialPageSummary, {
      timeout: 15000,
    });
  });
});

test.describe('nozzle-paa subquery filters', () => {
  const readUniqueQuestionsKpi = async (page: Page) => {
    const card = page.getByText('# of Unique Questions').locator('xpath=..');
    const valueText =
      (await card.locator(':scope > div').nth(1).textContent()) ?? '0';

    return Number(valueText.replaceAll(',', '').trim());
  };

  const readFirstQuestionMetric = async (page: Page) => {
    const questionCard = page.getByTestId('summary-table-question');
    const metricText =
      (await questionCard
        .locator('tbody tr')
        .first()
        .locator('td')
        .nth(2)
        .textContent()) ?? '';

    return Number(metricText.replaceAll(',', '').trim());
  };

  test('SERP Appearances widget filter applies HAVING and cross-filters siblings', async ({
    page,
  }) => {
    await initNozzlePaa(page);

    const initialKpi = await expect
      .poll(() => readUniqueQuestionsKpi(page))
      .toBeGreaterThan(0)
      .then(() => readUniqueQuestionsKpi(page));

    // The question table is sorted by SERP Appears descending, so the
    // unfiltered first row has the maximum count.
    const initialTopMetric = await readFirstQuestionMetric(page);
    expect(initialTopMetric).toBeGreaterThan(1);

    // Apply: SERP Appears < 5 (LESS THAN exercises the strict comparison and
    // is observable on the descending-sorted first row).
    await page.getByTestId('serp-appearances-op').selectOption('lt');
    await page.getByTestId('serp-appearances-value').fill('5');
    await page.getByTestId('serp-appearances-apply').check();

    // 1. Self: the question table's HAVING keeps only counts < 5.
    await expect
      .poll(() => readFirstQuestionMetric(page), { timeout: 15000 })
      .toBeLessThan(5);

    // 2. Siblings: the membership subquery shrinks the global KPI subset.
    await expect
      .poll(() => readUniqueQuestionsKpi(page), { timeout: 15000 })
      .not.toBe(initialKpi);

    // 3. The filter is visible as a removable chip.
    await expect(page.getByText('SERP Appears:')).toBeVisible();

    // 4. The surfaced SQL shows both predicate paths: HAVING on the question
    //    table itself, IN (SELECT ...) membership on a sibling.
    const questionSql = page
      .getByTestId('summary-table-question')
      .getByTestId('widget-sql');
    await expect(questionSql).toContainText('HAVING');
    await expect(questionSql).toContainText('count(*) < 5');

    const domainSql = page
      .getByTestId('summary-table-domain')
      .getByTestId('widget-sql');
    await expect(domainSql).toContainText('IN (SELECT');

    // Un-applying restores everything.
    await page.getByTestId('serp-appearances-apply').uncheck();

    await expect
      .poll(() => readUniqueQuestionsKpi(page), { timeout: 15000 })
      .toBe(initialKpi);
    await expect
      .poll(() => readFirstQuestionMetric(page), { timeout: 15000 })
      .toBe(initialTopMetric);
    await expect(page.getByText('SERP Appears:')).toHaveCount(0);
  });

  test('SERP filter chip removal also drops the HAVING clause', async ({
    page,
  }) => {
    await initNozzlePaa(page);

    const initialTopMetric = await expect
      .poll(() => readFirstQuestionMetric(page))
      .toBeGreaterThan(1)
      .then(() => readFirstQuestionMetric(page));

    await page.getByTestId('serp-appearances-op').selectOption('lt');
    await page.getByTestId('serp-appearances-value').fill('5');
    await page.getByTestId('serp-appearances-apply').check();

    await expect
      .poll(() => readFirstQuestionMetric(page), { timeout: 15000 })
      .toBeLessThan(5);

    // Remove via the active-filter chip: the widget un-applies itself and
    // clears both the membership subquery AND the HAVING clause.
    await page
      .getByText('SERP Appears:', { exact: true })
      .locator('xpath=..')
      .getByRole('button')
      .click();

    await expect(page.getByTestId('serp-appearances-apply')).not.toBeChecked();
    await expect
      .poll(() => readFirstQuestionMetric(page), { timeout: 15000 })
      .toBe(initialTopMetric);
  });

  test('top-page Question Domains filter restricts all widgets via IN (SELECT ...)', async ({
    page,
  }) => {
    await initNozzlePaa(page);

    const initialKpi = await expect
      .poll(() => readUniqueQuestionsKpi(page))
      .toBeGreaterThan(0)
      .then(() => readUniqueQuestionsKpi(page));

    await page.getByTestId('question-min-domains-input').fill('3');

    await expect
      .poll(() => readUniqueQuestionsKpi(page), { timeout: 15000 })
      .not.toBe(initialKpi);
    await expect(page.getByText('Min Domains:')).toBeVisible();

    await page.getByTestId('question-min-domains-input').fill('');

    await expect
      .poll(() => readUniqueQuestionsKpi(page), { timeout: 15000 })
      .toBe(initialKpi);
    await expect(page.getByText('Min Domains:')).toHaveCount(0);
  });
});
