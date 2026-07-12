import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The nozzle_test parquet is a fixed dataset (203,556 PAA rows: 2,681
// phrases, 4,779 questions, 7 days, 2 devices), so the suite asserts exact
// SQL-computed values — including the legacy suite's dataset literals
// ('gaz stove' / 'gasoline stove' share the top search volume).
const TOTAL_QUESTIONS = '4,779';
const TOTAL_QUESTIONS_NUM = 4_779;
const TOTAL_ROWS = '203,556';
const TOTAL_ROWS_NUM = 203_556;

const summaryTableIds = ['phrase', 'question', 'domain', 'url'] as const;

/** Reads a comma-formatted integer out of a locator's text (NaN → 0). */
async function readCount(locator: Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  return Number(text.replaceAll(/[^\d]/g, ''));
}

/**
 * Polls a comma-formatted count locator until it HOLDS the same finite value
 * across consecutive reads (optionally inside an open `(greaterThan, lessThan)`
 * interval), then returns that settled value.
 *
 * Authoring a `not_in` complement drives the detail count and its sibling KPI
 * through transient states before the result settles: the `in [reddit]` subset
 * (≈ the option's own count), and — while the facet's re-attach effect
 * reassociates its options client (see facet-multi-select.tsx) — a frame of the
 * unfiltered total. A bare "value changed" / "greater than the `in` subset" wait
 * races those: the unfiltered total is also greater than the subset, so a slow
 * runner (CI) captures `203,556` before the complement lands. The complement is
 * the ONLY value strictly between the subset and the unfiltered total, and it
 * must hold — so bound the interval AND require stability.
 */
async function waitForStableCount(
  locator: Locator,
  bounds: { greaterThan?: number; lessThan?: number } = {},
): Promise<number> {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const current = await readCount(locator);
        const withinBounds =
          (bounds.greaterThan === undefined || current > bounds.greaterThan) &&
          (bounds.lessThan === undefined || current < bounds.lessThan);
        const settled = withinBounds && current === previous;
        previous = current;
        return settled;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return previous;
}

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

test.describe('people-also-ask dashboard', () => {
  test('renders the header, KPIs, and initial summary tables', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(
      page.getByRole('heading', { level: 1, name: 'People Also Ask Report' }),
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

  test('first/last page buttons jump the phrase table to its boundary pages', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const card = page.getByTestId('summary-table-phrase');
    const firstButton = card.getByRole('button', {
      name: 'First Keyword Phrase page',
    });
    const prevButton = card.getByRole('button', {
      name: 'Previous Keyword Phrase page',
    });
    const nextButton = card.getByRole('button', {
      name: 'Next Keyword Phrase page',
    });
    const lastButton = card.getByRole('button', {
      name: 'Last Keyword Phrase page',
    });

    // Wait for the full first page to settle before reading button state.
    await expect(summaryRows(page, 'phrase')).toHaveCount(10);
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();
    await expect(lastButton).toBeEnabled();

    // 2,681 phrases / 10 per page → page 269 (index 268) is a 1-row remainder.
    const lastPage = Math.ceil(2_681 / 10);
    await lastButton.click();

    await expect(
      card.getByText(`Page ${lastPage} of ${lastPage}`),
    ).toBeVisible();
    await expect(summaryRows(page, 'phrase')).toHaveCount(2_681 % 10);
    await expect(nextButton).toBeDisabled();
    await expect(lastButton).toBeDisabled();
    await expect(firstButton).toBeEnabled();
    await expect(prevButton).toBeEnabled();

    await firstButton.click();

    await expect(card.getByText(`Page 1 of ${lastPage}`)).toBeVisible();
    await expect(summaryRows(page, 'phrase')).toHaveCount(10);
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
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

  // ── Foreign clauses + topology reset (issue #181 §6) ─────────────────────────
  // The "Domain spotlight" control publishes a point clause DIRECTLY to the
  // topology's `spotlight` Selection — never through the FilterSet. It surfaces
  // as a FOREIGN chip (the app-side useActiveFilters recipe unions FilterSet
  // chips with topology.activeClauses), narrows the page, is removable from the
  // bar (clearing the whole clause), and is cleared by topology.reset().

  test('the domain spotlight publishes a foreign clause that narrows the page and renders a removable foreign chip', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // The callout explains why this control is different from the rest.
    await expect(page.getByTestId('spotlight-domain-note')).toContainText(
      'bypasses the FilterSet',
    );

    // Spotlight reddit.com: a direct-to-Selection point clause narrows the
    // detail table to reddit.com's answer rows (17,902 — the share-loop value).
    await page.getByTestId('spotlight-domain-input').fill('reddit.com');
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '17,902 rows match',
      { timeout: 15_000 },
    );

    // A FOREIGN chip renders in the active-filter bar, badged SPOTLIGHT.
    const foreignChip = page.getByTestId('foreign-chip');
    await expect(foreignChip).toBeVisible();
    await expect(foreignChip).toContainText('Domain Spotlight:reddit.com');
    await expect(foreignChip.getByTestId('chip-target')).toHaveText(
      'SPOTLIGHT',
    );

    // Removing the foreign chip clears the WHOLE clause (publish null) — the
    // page returns to the unfiltered total and the bar disappears.
    await foreignChip
      .getByRole('button', { name: /Remove filter Domain Spotlight/ })
      .click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('topology reset (Clear All) clears both a FilterSet spec and the foreign spotlight clause', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // A FilterSet spec (min-domains → 418 questions)…
    await page.getByTestId('question-min-domains-input').fill('4');
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 15_000,
    });

    // …AND a foreign clause (spotlight reddit.com) active together.
    await page.getByTestId('spotlight-domain-input').fill('reddit.com');
    await expect(page.getByTestId('foreign-chip')).toBeVisible();
    const bar = page.getByTestId('active-filter-bar');
    await expect(bar).toContainText('Min Domains:≥ 4');
    await expect(bar).toContainText('Domain Spotlight:reddit.com');

    // Clear All is `topology.reset()`: it clears the FilterSet specs (chips +
    // URL params) AND the non-FilterSet spotlight clause in one call.
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS);
    await expect(page.getByTestId('question-min-domains-input')).toHaveValue(
      '',
    );
    await expect(page.getByTestId('spotlight-domain-input')).toHaveValue('');
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('detail column filters bridge into the page selection, and Clear All wins over TanStack Table state', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // Struct-path column: the ilike clause tests "related_phrase"."phrase".
    await page.getByTestId('detail-filter-question').fill('coleman');
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      '49,344 rows match',
    );
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'PAA Question:coleman',
    );

    // Global reset prunes the TanStack Table filter state through the bridge's
    // external-clear write-back — the input empties instead of republishing.
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('detail-filter-question')).toHaveValue('');
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

  // ── Builder view (issue #180 / #181) ─────────────────────────────────────────
  // The Builder is the full-power authoring surface; the Classic view is a
  // curated subset that never limits it. Every catalog field shares its
  // canonical spec id + kind with a Classic control, so setting a filter in
  // either view reflects losslessly in the other. The toggle defaults to
  // Classic so every test above sees the hardcoded bar.

  async function openBuilder(page: Page): Promise<void> {
    await page.getByTestId('filter-view-builder').click();
    await expect(page.getByTestId('filter-builder-add-field')).toBeVisible();
  }

  /**
   * The Builder add flow: pick a field, confirm with "Add & edit", and wait for
   * the field's editor popover to open. Returns the popover locator (the scope
   * every `filter-block-<id>-*` control lives inside).
   */
  async function addFilterField(page: Page, fieldId: string): Promise<Locator> {
    await page.getByTestId('filter-builder-add-field').selectOption(fieldId);
    await page.getByTestId('filter-builder-confirm').click();
    const popover = page.getByTestId(`filter-popover-${fieldId}`);
    await expect(popover).toBeVisible();
    return popover;
  }

  /** Opens (or re-opens) a materialized field's popover by clicking its button. */
  async function openFilterPopover(
    page: Page,
    fieldId: string,
  ): Promise<Locator> {
    await page.getByTestId(`filter-button-${fieldId}`).click();
    const popover = page.getByTestId(`filter-popover-${fieldId}`);
    await expect(popover).toBeVisible();
    return popover;
  }

  test('builder: the catalog exposes all eight fields', async ({ page }) => {
    await gotoDashboard(page);
    await openBuilder(page);

    const options = await page
      .getByTestId('filter-builder-add-field')
      .locator('option')
      .allInnerTexts();
    // 8 fields + the leading "Add field…" placeholder.
    for (const label of [
      'Phrase',
      'Domain',
      'Device',
      'Keyword Group',
      'Question',
      'Requested Date',
      'Search Volume',
      'Min Domains',
    ]) {
      expect(options).toContain(label);
    }
  });

  test('builder: (a) a Domain facet set in the Builder hydrates the Classic multi-select and back', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // Builder → set Domain (condition `in`) to reddit.com.
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    await reddit.click();

    const bar = page.getByTestId('active-filter-bar');
    await expect(bar).toContainText('reddit.com');
    await expect
      .poll(async () => {
        const text =
          (await page.getByTestId('detail-total-rows').textContent()) ?? '';
        return Number(text.replaceAll(/[^\d]/g, ''));
      })
      .toBeLessThan(203_556);

    // Switch to Classic: the Domain control DERIVES its selection from the
    // shared spec, so its trigger shows reddit.com immediately (not a stale
    // "All") — the stale-label fix.
    await page.getByTestId('filter-view-classic').click();
    await expect(
      page.getByTestId('filter-domain').locator('button').first(),
    ).toContainText('reddit.com');

    // The reverse direction: back in the Builder, the shared spec re-hydrates
    // the field as a closed button; opening its popover shows the reddit.com
    // option selected (aria-pressed).
    await page.getByTestId('filter-view-builder').click();
    const rebuilt = await openFilterPopover(page, 'domain');
    await expect(
      rebuilt
        .getByTestId('filter-block-domain-option')
        .filter({ hasText: /reddit\.com \(/ }),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  });

  test('builder: (a2) selecting one facet value keeps the rest of its own list pickable (self-exclusion)', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    const option = (re: RegExp) =>
      block.getByTestId('filter-block-domain-option').filter({ hasText: re });

    await expect(option(/^reddit\.com \(/)).toBeVisible({ timeout: 15_000 });

    // Pick reddit.com. Each PAA row has one domain, so a list that filtered by
    // its OWN selection would collapse to just reddit.com — self-exclusion must
    // keep every other domain (e.g. youtube.com) pickable so a second value can
    // be added.
    await option(/^reddit\.com \(/).click();
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'reddit.com',
    );
    await expect(option(/^youtube\.com \(/)).toBeVisible({ timeout: 15_000 });

    // And a second value can actually be selected.
    await option(/^youtube\.com \(/).click();
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'youtube.com',
    );
  });

  test('builder: (b) a Phrase text filter hydrates the Classic Phrase input', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'phrase');
    // Phrase defaults to `contains`; type a value.
    await block.getByTestId('filter-block-phrase-value').fill('stove');
    await expect(page.getByTestId('active-filter-bar')).toContainText('Phrase');

    // Classic Phrase input reflects the same shared `text:phrase` spec.
    await page.getByTestId('filter-view-classic').click();
    await expect(page.getByTestId('filter-phrase')).toHaveValue('stove');
  });

  test('builder: (c) a HAVING metric shares state with the classic metric control', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    // Build the per-keyword (HAVING) threshold in the Builder — it authors the
    // same `metric:phrase` spec the classic phrase-card metric control owns.
    const block = await addFilterField(page, 'search-volume');
    await block
      .getByTestId('filter-block-search-volume-placement')
      .selectOption({ label: 'per keyword (HAVING)' });
    await block
      .getByTestId('filter-block-search-volume-operator')
      .selectOption('gt');
    await block.getByTestId('filter-block-search-volume-value').fill('50000');
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2');
    const bar = page.getByTestId('active-filter-bar');
    await expect(bar.getByTestId('chip-target').first()).toHaveText('HAVING');

    // Switch to Classic: the phrase card's metric control hydrates from the same
    // spec — checkbox applied, comparison and threshold reflected.
    await page.getByTestId('filter-view-classic').click();
    await expect(page.getByTestId('metric-filter-phrase-apply')).toBeChecked();
    await expect(page.getByTestId('metric-filter-phrase-op')).toHaveValue('gt');
    await expect(page.getByTestId('metric-filter-phrase-value')).toHaveValue(
      '50000',
    );
  });

  test('builder: (d) the Domain list operator is changeable — not_in differs from in', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    await openBuilder(page);
    const block = await addFilterField(page, 'domain');

    // `in reddit.com` → the reddit.com answer subset (its own count).
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    const label = (await reddit.textContent()) ?? '';
    const inCount = /\(([\d,]+)\)/.exec(label)?.[1];
    if (inCount === undefined) {
      throw new Error(`facet option label has no count: ${label}`);
    }
    await reddit.click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${inCount} rows match`,
    );

    // Flip the operator to `not_in`: the complement (all rows NOT on reddit.com)
    // — a strictly different (larger) result than `in`.
    await block
      .getByTestId('filter-block-domain-operator')
      .selectOption('not_in');
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'reddit.com',
    );
    await expect(
      page.getByTestId('active-filter-bar').getByTestId('chip-operator'),
    ).toHaveText('not_in');
    // `not_in reddit.com` is the complement: a strictly larger, and different,
    // result than `in reddit.com` (and still a narrowing of the full dataset).
    // The settled complement is the only value strictly between the `in` subset
    // and the unfiltered total — wait for it to hold there, never the transient
    // full-total the re-attach effect flashes.
    const inRows = Number(inCount.replaceAll(',', ''));
    const notInRows = await waitForStableCount(
      page.getByTestId('detail-total-rows'),
      { greaterThan: inRows, lessThan: TOTAL_ROWS_NUM },
    );
    expect(notInRows).toBeGreaterThan(inRows);
    expect(notInRows).toBeLessThan(TOTAL_ROWS_NUM);
  });

  test('builder: (e) always-shown controls — Requested Date renders disabled placement + a disabled "in range" operator', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'requested-date');
    // A single-placement field still renders a placement control (disabled).
    await expect(
      block.getByTestId('filter-block-requested-date-placement'),
    ).toBeDisabled();
    // The interval kind has no operator axis → a disabled static "in range".
    const operator = block.getByTestId('filter-block-requested-date-operator');
    await expect(operator).toBeDisabled();
    await expect(operator).toContainText('in range');
  });

  test('builder: (f) an is_empty Phrase surfaces a "set in builder" hint on the classic control', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'phrase');
    // is_empty is arity 'none' → no value input, spec commits on operator pick.
    await block
      .getByTestId('filter-block-phrase-operator')
      .selectOption('is_empty');
    await expect(block.getByTestId('filter-block-phrase-value')).toHaveCount(0);
    await expect(page.getByTestId('active-filter-bar')).toContainText('Phrase');

    // Switch to Classic: the contains-only Phrase control can't represent an
    // is_empty filter, so it shows the divergence hint instead of looking empty.
    await page.getByTestId('filter-view-classic').click();
    await expect(page.getByTestId('filter-phrase-builder-hint')).toBeVisible();
  });

  test('builder: (g) a chip shows the operator and the WHERE/HAVING badge', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    await reddit.click();

    const bar = page.getByTestId('active-filter-bar');
    // The chip carries both a placement badge (WHERE) and the operator (in).
    await expect(bar.getByTestId('chip-target').first()).toHaveText('WHERE');
    await expect(bar.getByTestId('chip-operator').first()).toHaveText('in');
  });

  test('builder: (h) a Builder-chosen Domain not_in survives a Classic dropdown open', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // Builder → Domain = not_in [reddit.com].
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    // The reddit.com option label carries its own row count (the `in` subset);
    // capture it so we can wait for the not_in complement, which is strictly
    // larger, rather than racing the query that replaces the `in` count.
    const redditLabel = (await reddit.textContent()) ?? '';
    const inRows = Number(
      (/\(([\d,]+)\)/.exec(redditLabel)?.[1] ?? '').replaceAll(',', ''),
    );
    await reddit.click();
    await block
      .getByTestId('filter-block-domain-operator')
      .selectOption('not_in');

    const bar = page.getByTestId('active-filter-bar');
    await expect(bar.getByTestId('chip-operator')).toHaveText('not_in');
    // Capture the not_in (complement) result so we can prove it is untouched.
    // Wait until the detail count has SETTLED to the complement: the not_in
    // query resolves a frame after the chip flips, and the re-attach effect
    // flashes the unfiltered total in between — both a bare read and a
    // "greater than the `in` subset" poll would race those. The complement is
    // the only value strictly between the `in` subset and the unfiltered total.
    const complementRows = await waitForStableCount(
      page.getByTestId('detail-total-rows'),
      { greaterThan: inRows, lessThan: TOTAL_ROWS_NUM },
    );
    expect(complementRows).toBeLessThan(TOTAL_ROWS_NUM);

    // Classic → merely OPEN the Domain dropdown. The re-attach effect must NOT
    // rewrite the spec with the control's hardcoded `in`; the operator (and so
    // the result) must stay not_in.
    await page.getByTestId('filter-view-classic').click();
    await page.getByTestId('filter-domain').locator('button').first().click();
    await expect(
      page
        .getByTestId('filter-domain')
        .getByTestId('filter-domain-option')
        .filter({ hasText: /^reddit\.com \(/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Operator is still not_in and the result count is unchanged.
    await expect(bar.getByTestId('chip-operator')).toHaveText('not_in');
    await expect
      .poll(async () => {
        const text =
          (await page.getByTestId('detail-total-rows').textContent()) ?? '';
        return Number(text.replaceAll(/[^\d]/g, ''));
      })
      .toBe(complementRows);
  });

  test('builder: (i) switching placement mid-type does not resurrect the WHERE spec', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'search-volume');
    // Type a WHERE value (arms a 300ms debounce), then IMMEDIATELY switch the
    // placement to HAVING — the pending publish for the removed WHERE spec must
    // be cancelled, never producing a phantom `built:search-volume` chip.
    await block.getByTestId('filter-block-search-volume-value').fill('50000');
    await block
      .getByTestId('filter-block-search-volume-placement')
      .selectOption({ label: 'per keyword (HAVING)' });

    // Give the (cancelled) debounce well past its 300ms window to prove no
    // republish lands: no WHERE chip appears, only the deliberate HAVING one
    // once the user re-enters a value.
    const bar = page.getByTestId('active-filter-bar');
    await block
      .getByTestId('filter-block-search-volume-operator')
      .selectOption('gt');
    await block.getByTestId('filter-block-search-volume-value').fill('50000');
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2');
    // Exactly one Search-Volume chip, and it is the HAVING one.
    await expect(bar.getByTestId('chip-target')).toHaveCount(1);
    await expect(bar.getByTestId('chip-target')).toHaveText('HAVING');
  });

  test('builder: (j) removing a Phrase chip clears the input so an operator change cannot resurrect it', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);
    const block = await addFilterField(page, 'phrase');
    await block.getByTestId('filter-block-phrase-value').fill('stove');
    const bar = page.getByTestId('active-filter-bar');
    await expect(bar).toContainText('Phrase');

    // Remove the spec externally via its chip ✕. The click lands outside the
    // popover root, so it also light-dismisses the popover.
    await page.getByRole('button', { name: /Remove filter Phrase/ }).click();
    await expect(bar).toHaveCount(0);

    // Re-open the (still materialized, now unconfigured) field's popover: the
    // Builder input must have cleared (stale-state fix). Changing the operator
    // must NOT republish the deleted filter from stale text.
    await openFilterPopover(page, 'phrase');
    await expect(block.getByTestId('filter-block-phrase-value')).toHaveValue(
      '',
    );
    await block
      .getByTestId('filter-block-phrase-operator')
      .selectOption('starts_with');
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  // ── URL share-loop round-trips (filter-url.ts codec fixes) ───────────────────
  // The consumer-owned URL persister must round-trip every Builder-authored
  // filter: non-default operators, valueless emptiness specs, the per-row Search
  // Volume WHERE spec, and legacy param aliases. Each test drives the real
  // hydration path (a fresh navigation reads location.search on set creation).

  test('builder: (k) a Domain not_in survives the URL share-loop', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    // Author Domain = not_in [reddit.com] in the Builder.
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    // Capture reddit.com's own row count (the `in` subset) so we can wait for
    // the strictly-larger not_in complement rather than racing the query that
    // replaces the `in` count.
    const redditLabel = (await reddit.textContent()) ?? '';
    const inRows = Number(
      (/\(([\d,]+)\)/.exec(redditLabel)?.[1] ?? '').replaceAll(',', ''),
    );
    await reddit.click();
    await block
      .getByTestId('filter-block-domain-operator')
      .selectOption('not_in');

    const bar = page.getByTestId('active-filter-bar');
    await expect(bar.getByTestId('chip-operator')).toHaveText('not_in');
    // Wait for the detail count to SETTLE to the complement (strictly between the
    // `in` subset and the unfiltered total) so both the KPI and the row count are
    // read once results have settled — not the loading placeholder, the pre-filter
    // total, or the transient `in` count. The KPI resolves on its own query a beat
    // behind the detail count, so wait for it to hold too: it is the COMPLEMENT
    // (fewer than the unfiltered total) the shared link must reproduce exactly,
    // never the transient `in` count a bare snapshot here would capture.
    const complementRows = await waitForStableCount(
      page.getByTestId('detail-total-rows'),
      { greaterThan: inRows, lessThan: TOTAL_ROWS_NUM },
    );
    await waitForStableCount(page.getByTestId('kpi-questions'), {
      greaterThan: 0,
      lessThan: TOTAL_QUESTIONS_NUM,
    });
    const questionsText =
      (await page.getByTestId('kpi-questions').textContent()) ?? '';
    const complementText =
      (await page.getByTestId('detail-total-rows').textContent()) ?? '';

    // The URL must carry the non-default operator (the `op~` envelope), not a
    // bare list that would silently decode back to `in`.
    // `~` percent-encodes to `%7E` when URLSearchParams serializes the value.
    const url = page.url();
    expect(url).toContain('op%7Enot_in%7E');

    // Reload the shared link from scratch: the persister hydrates the set before
    // first paint, so the chip operator and the (complement) result stay not_in.
    await page.goto(url);
    await expect(page.getByTestId('kpi-questions')).toHaveText(questionsText, {
      timeout: 90_000,
    });
    await expect(
      page.getByTestId('active-filter-bar').getByTestId('chip-operator'),
    ).toHaveText('not_in');
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      complementText,
    );
    // Prove the filter is genuinely active: the complement KPI is not the
    // unfiltered total, and the row count is below the full dataset.
    expect(questionsText).not.toBe(TOTAL_QUESTIONS);
    expect(complementRows).toBeLessThan(TOTAL_ROWS_NUM);
  });

  test('builder: (l) a valueless is_empty Domain spec survives the URL share-loop', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Author Domain is_empty (arity none → no value list; commits on operator).
    await openBuilder(page);
    const block = await addFilterField(page, 'domain');
    await expect(block.getByTestId('filter-block-domain-operator')).toBeVisible(
      { timeout: 15_000 },
    );
    await block
      .getByTestId('filter-block-domain-operator')
      .selectOption('is_empty');
    await expect(
      page.getByTestId('active-filter-bar').getByTestId('chip-operator'),
    ).toHaveText('is_empty');
    // The is_empty filter selects the subset of PAA rows whose domain is empty,
    // so the questions KPI is a proper subset of the total, not zero. Poll for
    // the settled value (below the total), then capture it; the shared link must
    // reproduce exactly this.
    await expect.poll(() => readQuestionsKpi(page)).toBeLessThan(4_779);
    const questionsText =
      (await page.getByTestId('kpi-questions').textContent()) ?? '';
    expect(questionsText).not.toBe(TOTAL_QUESTIONS);

    // The URL carries the valueless envelope (marker, empty value tail); `~`
    // percent-encodes to `%7E`.
    const url = page.url();
    expect(url).toContain('op%7Eis_empty%7E');

    // The emptiness filter's result must survive the reload rather than the
    // spec vanishing from the link.
    await page.goto(url);
    await expect(page.getByTestId('kpi-questions')).toHaveText(questionsText, {
      timeout: 90_000,
    });
    await expect(
      page.getByTestId('active-filter-bar').getByTestId('chip-operator'),
    ).toHaveText('is_empty');
  });

  test('builder: (m) a per-row Search Volume WHERE filter survives the URL share-loop', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Author Search Volume "per row (WHERE)" gt 50000 — a `built:search-volume`
    // condition spec (distinct from the phrase card's HAVING metric).
    await openBuilder(page);
    const block = await addFilterField(page, 'search-volume');
    await block
      .getByTestId('filter-block-search-volume-placement')
      .selectOption({ label: 'per row (WHERE)' });
    await block
      .getByTestId('filter-block-search-volume-operator')
      .selectOption('gt');
    await block.getByTestId('filter-block-search-volume-value').fill('50000');

    const bar = page.getByTestId('active-filter-bar');
    await expect(bar.getByTestId('chip-target').first()).toHaveText('WHERE');
    // The detail query settles asynchronously after the debounced write; wait
    // for the filtered count before capturing the share-loop baseline, or the
    // capture races the query and grabs the unfiltered total.
    const totalRows = Number(TOTAL_ROWS.replaceAll(/[^\d]/g, ''));
    await expect
      .poll(async () => {
        const text =
          (await page.getByTestId('detail-total-rows').textContent()) ?? '';
        const rows = Number(text.replaceAll(/[^\d]/g, ''));
        return rows > 0 && rows < totalRows;
      })
      .toBe(true);
    const filteredText =
      (await page.getByTestId('detail-total-rows').textContent()) ?? '';

    // The URL must carry the built:search-volume param (write() previously
    // skipped this unknown id, dropping the filter on reload).
    const url = page.url();
    expect(url).toContain('built%3Asearch-volume=gt%3A50000');

    await page.goto(url);
    await expect(page.getByTestId('kpi-questions')).toBeVisible({
      timeout: 90_000,
    });
    await expect(bar.getByTestId('chip-target').first()).toHaveText('WHERE');
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      filteredText,
    );
  });

  test('builder: (n) a legacy ?f.text:desc= link hydrates the description detail filter', async ({
    page,
  }) => {
    // Land directly on an OLD shared link: the dropped Answer-Text control's
    // param must decode to the canonical detail:description filter.
    await page.goto('/?f.text:desc=coleman');
    await expect(page.getByTestId('kpi-questions')).toBeVisible({
      timeout: 90_000,
    });

    // A description filter is active (chip present) and narrows the result.
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'Answer Description:coleman',
    );
    await expect
      .poll(async () => {
        const text =
          (await page.getByTestId('detail-total-rows').textContent()) ?? '';
        return Number(text.replaceAll(/[^\d]/g, ''));
      })
      .toBeLessThan(203_556);

    // The write side re-emits it under the canonical param, dropping the legacy
    // key — the detail input reflects the hydrated value.
    await expect(page.getByTestId('detail-filter-description')).toHaveValue(
      'coleman',
    );
  });

  test('builder: (o) a metric HAVING chip still reads HAVING after a URL reload', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Apply the classic phrase-card metric threshold (writes metric:phrase with
    // no decorative target now that the resolved-target fix landed).
    await page.getByTestId('metric-filter-phrase-value').fill('50000');
    await page.getByTestId('metric-filter-phrase-apply').check();
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2');
    const bar = page.getByTestId('active-filter-bar');
    await expect(bar.getByTestId('chip-target').first()).toHaveText('HAVING');

    // Reload the shared link: the spec carries no `target`, so the HAVING badge
    // must come from the kind's published emission targets (the resolved-target
    // fix), not a decorative spec field.
    const url = page.url();
    await page.goto(url);
    await expect(page.getByTestId('kpi-phrases')).toHaveText('2', {
      timeout: 90_000,
    });
    await expect(bar.getByTestId('chip-target').first()).toHaveText('HAVING');
  });

  // ── Builder add flow: confirm → button → popover (issue #180 UX) ─────────────
  // Selecting a field no longer auto-adds it: the user confirms with "Add &
  // edit", which materializes a compact filter button and opens its editor
  // popover. Only one popover is open at a time; it light-dismisses on Escape or
  // an outside click, and "Remove filter" inside it drops the chip and button.

  test('builder: (p) the add flow gates on confirm, materializes a button + popover, and light-dismisses', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openBuilder(page);

    // Confirm is disabled until a field is picked.
    const confirm = page.getByTestId('filter-builder-confirm');
    await expect(confirm).toBeDisabled();

    // Picking Domain enables confirm but does NOT materialize a button yet.
    await page.getByTestId('filter-builder-add-field').selectOption('domain');
    await expect(confirm).toBeEnabled();
    await expect(page.getByTestId('filter-button-domain')).toHaveCount(0);

    // Confirming materializes the button, opens its popover, resets the select
    // (confirm re-disables), and excludes Domain from the remaining options.
    await confirm.click();
    await expect(page.getByTestId('filter-button-domain')).toBeVisible();
    await expect(page.getByTestId('filter-popover-domain')).toBeVisible();
    await expect(page.getByTestId('filter-builder-add-field')).toHaveValue('');
    await expect(confirm).toBeDisabled();
    await expect(
      page
        .getByTestId('filter-builder-add-field')
        .locator('option[value="domain"]'),
    ).toHaveCount(0);

    // Escape closes the popover; the button remains.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('filter-popover-domain')).toBeHidden();
    await expect(page.getByTestId('filter-button-domain')).toBeVisible();

    // Clicking the button re-opens it; an outside click (on the KPI header)
    // closes it again.
    await page.getByTestId('filter-button-domain').click();
    await expect(page.getByTestId('filter-popover-domain')).toBeVisible();
    await page.getByTestId('kpi-questions').click();
    await expect(page.getByTestId('filter-popover-domain')).toBeHidden();

    // Commit a value, then "Remove filter" from the popover drops both the chip
    // and the button.
    const block = await openFilterPopover(page, 'domain');
    const reddit = block
      .getByTestId('filter-block-domain-option')
      .filter({ hasText: /^reddit\.com \(/ });
    await expect(reddit).toBeVisible({ timeout: 15_000 });
    await reddit.click();
    await expect(page.getByTestId('active-filter-bar')).toContainText(
      'reddit.com',
    );
    await block.getByTestId('filter-block-domain-remove').click();
    await expect(page.getByTestId('filter-button-domain')).toHaveCount(0);
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('every widget exposes the SQL it last executed', async ({ page }) => {
    await gotoDashboard(page);

    // 4 summary tables + the detail table each render a SQL footer. The vgplot
    // volume-brush panel is not a data-client store (no `lastQuery`), so it adds
    // no footer — the count stays 5.
    await expect(page.getByTestId('widget-sql')).toHaveCount(5);
    const first = page.getByTestId('widget-sql').first();
    await first.locator('summary').click();
    await expect(first.locator('pre')).toContainText('SELECT');
  });

  // The vgplot brush publishes a search-volume range into the foreign
  // `volumeBrush` Selection (never the FilterSet), like the domain spotlight.

  /**
   * Expands the panel and drags a brush across the right half of the plot (the
   * high-volume tail), then waits for the questions KPI to settle below the full
   * total. The plot's SVG has a fixed 900×300 coordinate space but is scaled to
   * its container, so the drag operates on the on-screen box.
   */
  async function brushVolumeRange(page: Page): Promise<void> {
    await page.getByTestId('volume-brush-toggle').click();
    await expect(page.getByTestId('volume-brush-panel')).toHaveAttribute(
      'data-expanded',
      'true',
    );
    const svg = page.locator('[data-testid="volume-brush-plot"] svg');
    // Settle the plot before capturing its box: on expand it re-renders (its
    // mark query may still be in flight when the page is already filtered) and
    // the page can reflow. Scroll it into view, then poll until its on-screen
    // box stops moving — a mid-drag layout shift would send the mouse events to
    // the wrong coordinates and the brush would never register.
    await svg.scrollIntoViewIfNeeded();
    let previous = '';
    await expect
      .poll(async () => {
        const current = await svg.boundingBox();
        const key = current === null ? '' : `${current.x},${current.y}`;
        const settled = key !== '' && key === previous;
        previous = key;
        return settled;
      })
      .toBe(true);
    const box = await svg.boundingBox();
    if (box === null) {
      throw new Error('volume-brush plot svg not found');
    }
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, y, { steps: 12 });
    await page.mouse.up();

    // The drag published a clause: the range strip leaves "Full range". This
    // signals the brush landed even when the page is already filtered (so the
    // questions KPI is below the total before brushing).
    await expect(page.getByTestId('volume-brush-range')).not.toContainText(
      'Full range',
    );
    // The brushed range narrows the page: the questions KPI settles above zero.
    await waitForStableCount(page.getByTestId('kpi-questions'), {
      greaterThan: 0,
      lessThan: TOTAL_QUESTIONS_NUM,
    });
  }

  test('the volume-brush panel expands and collapses', async ({ page }) => {
    await gotoDashboard(page);

    const panel = page.getByTestId('volume-brush-panel');
    await expect(panel).toHaveAttribute('data-expanded', 'false');
    // The compact panel still renders its histogram bars.
    await expect
      .poll(async () =>
        page.locator('[data-testid="volume-brush-plot"] rect').count(),
      )
      .toBeGreaterThan(5);

    await page.getByTestId('volume-brush-toggle').click();
    await expect(panel).toHaveAttribute('data-expanded', 'true');

    await page.getByTestId('volume-brush-toggle').click();
    await expect(panel).toHaveAttribute('data-expanded', 'false');
  });

  test('brushing the volume histogram narrows the page and renders a removable foreign chip', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    await brushVolumeRange(page);

    // The detail table (and every widget) narrows to the brushed subset.
    const brushedRows = await readCount(page.getByTestId('detail-total-rows'));
    expect(brushedRows).toBeGreaterThan(0);
    expect(brushedRows).toBeLessThan(TOTAL_ROWS_NUM);

    // A FOREIGN chip renders, labeled from the declaration and badged BRUSH.
    const foreignChip = page.getByTestId('foreign-chip');
    await expect(foreignChip).toBeVisible();
    await expect(foreignChip).toContainText('Search Volume:');
    await expect(foreignChip.getByTestId('chip-target')).toHaveText('BRUSH');
    // The panel's summary strip reflects the committed range (not "Full range").
    await expect(page.getByTestId('volume-brush-range')).not.toContainText(
      'Full range',
    );

    // Removing the chip clears the whole clause — the page returns to total.
    await foreignChip
      .getByRole('button', { name: /Remove filter Search Volume/ })
      .click();
    await expect(page.getByTestId('detail-total-rows')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
    await expect(page.getByTestId('volume-brush-range')).toContainText(
      'Full range',
    );
    // The external clear also resets the interactor: the brush overlay is no
    // longer painted (it must not linger until the next click on the chart).
    await expect(
      page.locator('[data-testid="volume-brush-plot"] svg rect.selection'),
    ).toBeHidden();
  });

  test('the brushed range and its overlay survive an expand/collapse toggle', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Brush the high-volume tail in the expanded plot.
    await brushVolumeRange(page);
    const brushedQuestions = await readCount(page.getByTestId('kpi-questions'));
    expect(brushedQuestions).toBeGreaterThan(0);
    expect(brushedQuestions).toBeLessThan(TOTAL_QUESTIONS_NUM);

    // The D3 brush overlay (rect.selection) is painted with a non-zero width.
    const brushRect = page.locator(
      '[data-testid="volume-brush-plot"] svg rect.selection',
    );
    const widthBefore = await brushRect.evaluate((rect) =>
      Number((rect as SVGRectElement).getAttribute('width')),
    );
    expect(widthBefore).toBeGreaterThan(0);

    // Collapse the panel — the plot is resized in place, not remounted, so the
    // interval interactor and its overlay survive.
    await page.getByTestId('volume-brush-toggle').click();
    await expect(page.getByTestId('volume-brush-panel')).toHaveAttribute(
      'data-expanded',
      'false',
    );

    // The brush rectangle is still visible with a non-zero width in the
    // re-rendered (compact) plot.
    await expect(brushRect).toBeVisible();
    await expect
      .poll(async () =>
        brushRect.evaluate((rect) =>
          Number((rect as SVGRectElement).getAttribute('width')),
        ),
      )
      .toBeGreaterThan(0);

    // The clause never dropped: the questions KPI is unchanged by the toggle
    // (still the brushed subset, not the full total).
    await expect(page.getByTestId('kpi-questions')).toHaveText(
      brushedQuestions.toLocaleString('en-US'),
    );
    await expect(page.getByTestId('volume-brush-range')).not.toContainText(
      'Full range',
    );

    // The restored brush is still interactive: expanding again keeps it, and
    // the foreign chip stays live and removable.
    await page.getByTestId('volume-brush-toggle').click();
    await expect(page.getByTestId('volume-brush-panel')).toHaveAttribute(
      'data-expanded',
      'true',
    );
    await expect(brushRect).toBeVisible();
    const foreignChip = page.getByTestId('foreign-chip');
    await expect(foreignChip).toContainText('Search Volume:');
  });

  test('Clear All clears the volume brush alongside a FilterSet spec', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // A FilterSet spec (min-domains → 418 questions)…
    await page.getByTestId('question-min-domains-input').fill('4');
    await expect(page.getByTestId('kpi-questions')).toHaveText('418', {
      timeout: 15_000,
    });

    // …AND the foreign volume-brush clause active together.
    await brushVolumeRange(page);
    const bar = page.getByTestId('active-filter-bar');
    await expect(bar).toContainText('Min Domains:≥ 4');
    await expect(bar.getByTestId('foreign-chip')).toContainText(
      'Search Volume:',
    );

    // Clear All (topology.reset) clears BOTH in one call.
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-questions')).toHaveText(TOTAL_QUESTIONS);
    await expect(page.getByTestId('question-min-domains-input')).toHaveValue(
      '',
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
    await expect(page.getByTestId('volume-brush-range')).toContainText(
      'Full range',
    );
    // Clear All resets the interactor too — no stale brush overlay.
    await expect(
      page.locator('[data-testid="volume-brush-plot"] svg rect.selection'),
    ).toBeHidden();
  });
});
