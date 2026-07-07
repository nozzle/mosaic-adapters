import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Same pinned dataset as questions.test.ts (203,556 PAA rows). These are the
// exact SQL-computed values the share-loop hydrates back to, reused verbatim.
const TOTAL_QUESTIONS = '4,779';

/** Waits on DuckDB-WASM + the proxied parquet by pinning the questions KPI. */
async function waitForDashboard(page: Page): Promise<void> {
  await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS, {
    timeout: 90_000,
  });
}

/** Loads the dashboard at its root (empty filter state). */
async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await waitForDashboard(page);
}

/** The current `f.` search params, keyed by spec id (prefix stripped). */
async function filterParams(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    for (const [key, value] of params) {
      if (key.startsWith('f.')) {
        result[key.slice(2)] = value;
      }
    }
    return result;
  });
}

test.describe('people-also-ask share loop', () => {
  test('filtering via the UI writes exactly the touched per-entry params', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // A first filter: min-domains 4. Its param appears; nothing else does.
    await page.getByTestId('question-min-domains-input').fill('4');
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 15_000,
    });
    await expect.poll(() => filterParams(page)).toEqual({ minDomains: '4' });

    // A second filter: the reddit.com domain facet. It adds its own param and
    // must not disturb the first spec's param.
    await page.getByTestId('filter-domain').locator('button').first().click();
    const reddit = page
      .getByTestId('filter-domain')
      .getByRole('button', { name: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    await reddit.click();

    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Domain:reddit.com',
    );
    await expect
      .poll(() => filterParams(page))
      .toEqual({ minDomains: '4', 'facet:domain': 'reddit.com' });
  });

  test('a min-domains URL hydrates to the identical filtered state', async ({
    page,
  }) => {
    await page.goto('/?f.minDomains=4');
    // Hydrates synchronously pre-first-query: the KPI lands on the filtered
    // value, never flashing the unfiltered 4,779.
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 90_000,
    });
    // The chip and the input both reflect the hydrated intent.
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Min Domains:≥ 4',
    );
    await expect(page.getByTestId('question-min-domains-input')).toHaveValue(
      '4',
    );
  });

  test('a domain-facet URL hydrates the detail total to the facet count', async ({
    page,
  }) => {
    await page.goto('/?f.facet:domain=reddit.com');
    // Pre-filtered on load, so the questions KPI never shows the unfiltered
    // total — assert the narrowed detail total directly (cold-start timeout).
    // reddit.com's answer count is the narrowed detail total (test 12's value).
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '17,902 rows match',
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Domain:reddit.com',
    );
  });

  test('a metric-threshold URL hydrates the KPI, rows, chip, and checkbox', async ({
    page,
  }) => {
    await page.goto('/?f.metric:question=gt:5000');
    // Exactly 3 questions appear on more than 5,000 SERPs.
    await expect(page.getByTestId('kpi-questions')).toHaveText('3', {
      timeout: 90_000,
    });
    await expect(
      page.getByTestId('summary-table-question').locator('tbody tr'),
    ).toHaveCount(3);
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'SERP Appears:> 5000',
    );
    // The control derives its applied state from the hydrated spec.
    await expect(
      page.getByTestId('metric-filter-question-apply'),
    ).toBeChecked();
  });

  test('a detail-column URL hydrates the query and the TanStack Table input', async ({
    page,
  }) => {
    await page.goto('/?f.detail:question=coleman');
    // Pre-filtered on load: assert the narrowed detail total directly (the
    // struct-path ilike, test 11's pinned value) with a cold-start timeout.
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '49,344 rows match',
      { timeout: 90_000 },
    );
    // …and the bridge's adoption path drives the TanStack Table column input.
    await expect(page.getByTestId('detail-filter-question')).toHaveValue(
      'coleman',
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'PAA Question:coleman',
    );
  });

  test('removing a chip clears its URL entry (the external reason path)', async ({
    page,
  }) => {
    await page.goto('/?f.minDomains=4&f.facet:domain=reddit.com');
    await expect(page.getByTestId('kpi-questions')).toHaveText(/^\d/, {
      timeout: 90_000,
    });
    await expect
      .poll(() => filterParams(page))
      .toEqual({ minDomains: '4', 'facet:domain': 'reddit.com' });

    // Remove just the domain chip: its param clears, the min-domains one stays.
    await page
      .getByRole('button', { name: /Remove filter Domain: reddit\.com/ })
      .click();
    await expect(page.getByTestId('active-filter-bar')).not.toContainText(
      'Domain:reddit.com',
    );
    await expect.poll(() => filterParams(page)).toEqual({ minDomains: '4' });
  });

  test('Clear All drops every f. param', async ({ page }) => {
    await page.goto('/?f.minDomains=4&f.facet:domain=reddit.com');
    await expect(page.getByTestId('active-filter-bar')).toBeVisible({
      timeout: 90_000,
    });

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS);
    await expect.poll(() => filterParams(page)).toEqual({});
  });

  test('summary row selections round-trip through the URL', async ({
    page,
    context,
  }) => {
    await gotoDashboard(page);

    // Select two question rows via the UI (no hardcoded row values — the
    // narrowed KPI count is the pinned assertion, as in the main suite).
    const questionRows = page
      .getByTestId('summary-table-question')
      .locator('tbody tr');
    await questionRows.nth(0).click();
    await questionRows.nth(1).click();
    await expect(page.getByTestId('kpi-questions')).toHaveText('2', {
      timeout: 15_000,
    });
    await expect
      .poll(async () => Object.keys(await filterParams(page)))
      .toEqual(['select:question']);

    // Open the exact URL in a fresh page: it hydrates to the same state.
    const sharedUrl = page.url();
    const shared = await context.newPage();
    await shared.goto(sharedUrl);
    await expect(shared.getByTestId('kpi-questions')).toHaveText('2', {
      timeout: 90_000,
    });
    // Exploded per-value chips in the bar, and the in-widget selection strip.
    await expect(shared.getByText('Selected Question:')).toHaveCount(2);
    await expect(shared.getByText(/^Selected \(2\)$/)).toBeVisible();

    // Removing one chip narrows the spec (its param survives, one value)…
    await shared
      .getByRole('button', { name: /Remove filter Selected Question/ })
      .first()
      .click();
    await expect(shared.getByTestId('kpi-questions')).toHaveText('1');
    await expect
      .poll(async () => Object.keys(await filterParams(shared)))
      .toEqual(['select:question']);

    // …removing the last chip clears the param entirely.
    await shared
      .getByRole('button', { name: /Remove filter Selected Question/ })
      .click();
    await expect(shared.getByTestId('kpi-questions')).toHaveText(
      TOTAL_QUESTIONS,
    );
    await expect.poll(() => filterParams(shared)).toEqual({});
    await shared.close();
  });

  test('a filter survives a mid-state reload', async ({ page }) => {
    await gotoDashboard(page);

    await page.getByTestId('question-min-domains-input').fill('4');
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 15_000,
    });
    await expect.poll(() => filterParams(page)).toEqual({ minDomains: '4' });

    await page.reload();

    // The URL carried the state across the reload; it re-hydrates to 418.
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 90_000,
    });
    await expect(page.getByTestId('question-min-domains-input')).toHaveValue(
      '4',
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Min Domains:≥ 4',
    );
  });
});
