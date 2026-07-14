import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The dashboard reads a fixed parquet (203,556 rows: 2,681 phrases, 4,779
// questions, 7 days, 2 devices), so the SQL-computed KPI values are exact.
// `kpi_phrases` and `kpi_phrases_all` both read count(DISTINCT phrase); the
// latter omits `filter_by`, so it stays 2,681 no matter what filters are active
// while the former reacts.
const TOTAL_QUESTIONS = '4,779';
const TOTAL_PHRASES = '2,681';
const TOTAL_ROWS = '203,556';
const TOTAL_PHRASES_NUM = 2_681;
const TOTAL_ROWS_NUM = 203_556;

const KPI_VALUE_IDS = [
  'kpi-kpi_phrases-value',
  'kpi-kpi_questions-value',
  'kpi-kpi_days-value',
  'kpi-kpi_devices-value',
  'kpi-kpi_phrases_all-value',
] as const;

const SUMMARY_IDS = [
  'summary-table-by_phrase',
  'summary-table-by_domain',
  'summary-table-by_device',
  'summary-table-by_bucket',
] as const;

/** Reads a comma-formatted integer out of a locator's text (NaN → 0). */
async function readCount(locator: Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  return Number(text.replaceAll(/[^\d]/g, ''));
}

/**
 * The questions spec declares a URL-persisted filter DEFAULT (a `facet:domain`
 * list of the five major answer domains), so a fresh load hydrates FILTERED.
 * Clear it so the baseline is the full unfiltered dataset the exact-value
 * assertions below expect. The
 * opt-out KPI (`kpi_phrases_all`, no `filter_by`) is a dataset constant
 * regardless of filters, so it proves the whole pipeline loaded before the
 * clear; after the clear every owned filter is gone and the active bar empties.
 */
async function clearDefaultFilters(page: Page): Promise<void> {
  await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
    TOTAL_PHRASES,
    { timeout: 90_000 },
  );
  await page.getByTestId('clear-all-filters').click();
  await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
}

/**
 * First paint waits on DuckDB-WASM instantiation, the proxied parquet download,
 * and the derived `questions_enriched` table. Clear the spec-declared defaults,
 * then wait on a KPI whose value is a dataset constant so the whole pipeline
 * (spec fetch → compile → topology → load → query) is proven, and the baseline
 * is unfiltered, before any assertion.
 */
async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await clearDefaultFilters(page);
  await expect(page.getByTestId('kpi-kpi_questions-value')).toHaveText(
    TOTAL_QUESTIONS,
    { timeout: 90_000 },
  );
}

/** Commit a real interval selection against the dashboard's volume histogram. */
async function brushVolumePlot(
  page: Page,
  widgetId = 'volume_brush',
): Promise<void> {
  const plot = page.getByTestId(`vgplot-${widgetId}-plot`);
  await expect(plot.locator('svg')).toBeVisible({ timeout: 30_000 });
  await plot.scrollIntoViewIfNeeded();
  let box: { x: number; y: number; width: number; height: number } | null =
    null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    box = await plot.locator('svg').boundingBox();
    if (box !== null) {
      break;
    }
    await page.waitForTimeout(250);
  }
  if (box === null) {
    throw new Error(`vgplot ${widgetId} brush svg box not found`);
  }
  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.42, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, midY, { steps: 10 });
  await page.mouse.up();
}

/** Width of the painted interval overlay, or zero when the brush is clear. */
async function brushSelectionWidth(
  page: Page,
  widgetId: string,
): Promise<number> {
  const geometry = await page
    .getByTestId(`vgplot-${widgetId}-plot`)
    .locator('g.interval-x rect.selection')
    .evaluateAll((rects) =>
      rects.reduce(
        (largest, rect) => {
          const width = Number(rect.getAttribute('width') ?? 0);
          return width > largest.width
            ? { x: Number(rect.getAttribute('x') ?? 0), width }
            : largest;
        },
        { x: 0, width: 0 },
      ),
    );
  return geometry.width;
}

/** True when the two full-width plots paint the same brush geometry. */
async function brushSelectionsMatch(page: Page): Promise<boolean> {
  const geometry = async (widgetId: string) =>
    page
      .getByTestId(`vgplot-${widgetId}-plot`)
      .locator('g.interval-x rect.selection')
      .evaluateAll((rects) =>
        rects.reduce(
          (largest, rect) => {
            const width = Number(rect.getAttribute('width') ?? 0);
            return width > largest.width
              ? { x: Number(rect.getAttribute('x') ?? 0), width }
              : largest;
          },
          { x: 0, width: 0 },
        ),
      );
  const [primary, mirror] = await Promise.all([
    geometry('volume_brush'),
    geometry('volume_brush_mirror'),
  ]);
  return (
    primary.width > 0 &&
    mirror.width > 0 &&
    Math.abs(primary.x - mirror.x) < 1 &&
    Math.abs(primary.width - mirror.width) < 1
  );
}

/** Painted rectangle geometry for the protein-design intervalXY brush. */
async function scatterBrushGeometry(
  page: Page,
): Promise<{ width: number; height: number }> {
  return page
    .getByTestId('vgplot-scatter-plot')
    .locator('g.interval-xy rect.selection')
    .evaluateAll((rects) =>
      rects.reduce(
        (largest, rect) => {
          const candidate = {
            width: Number(rect.getAttribute('width') ?? 0),
            height: Number(rect.getAttribute('height') ?? 0),
          };
          return candidate.width * candidate.height >
            largest.width * largest.height
            ? candidate
            : largest;
        },
        { width: 0, height: 0 },
      ),
    );
}

/** Commit a real diagonal intervalXY selection on the protein scatter plot. */
async function brushProteinScatter(page: Page): Promise<void> {
  const plot = page.getByTestId('vgplot-scatter-plot');
  await expect(plot.locator('svg')).toBeVisible({ timeout: 30_000 });
  await plot.scrollIntoViewIfNeeded();
  let box: { x: number; y: number; width: number; height: number } | null =
    null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    box = await plot.locator('svg').boundingBox();
    if (box !== null) {
      break;
    }
    await page.waitForTimeout(250);
  }
  if (box === null) {
    throw new Error('protein scatter svg box not found');
  }
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
    steps: 30,
  });
  await page.mouse.up();
}

function summaryRows(page: Page, id: string): Locator {
  return page.getByTestId(id).locator('tbody tr');
}

/**
 * Drive the enlarge → select-in-promoted → return sequence for a selection
 * table and assert the collapsed table still shows its non-selected rows
 * (dimmed), not just the selected ones.
 *
 * Regression guard for the "collapsed table shows only the selected rows"
 * failure mode: on the enlarge/return remount the page FilterSet keeps the
 * card's `select:<card>` spec alive and the rows client re-adopts it to re-key
 * its crossfilter self-exclusion to the freshly-mounted client. The card must
 * never be filtered by its OWN selection, so after collapsing the row count has
 * to exceed the selected count and at least one non-selected row must remain
 * (rendered dimmed via `opacity-30`). React StrictMode's mount→unmount→mount
 * double-invoke widens the remount window, but the failure mode is timing-
 * sensitive rather than dev-only — it reproduces in the production preview build
 * Playwright's webServer runs here too.
 */
async function expandSelectCollapseAndAssert(
  page: Page,
  id: string,
): Promise<void> {
  const table = page.getByTestId(id);
  await expect
    .poll(async () => summaryRows(page, id).count())
    .toBeGreaterThan(3);
  const initialRows = await summaryRows(page, id).count();

  // Enlarge: the promoted copy renders full-width (data-mode="promoted") while a
  // placeholder holds the grid slot.
  await page.getByTestId(`${id}-toggle`).click();
  await expect(table).toHaveAttribute('data-mode', 'promoted');
  await expect
    .poll(async () => summaryRows(page, id).count())
    .toBeGreaterThan(3);

  // Select the first two rows in the promoted view.
  const rows = summaryRows(page, id);
  await rows.nth(0).click();
  await rows.nth(1).click();
  const checked = table.locator('tbody tr input[type=checkbox]:checked');
  await expect(checked).toHaveCount(2);

  // Return to the grid: the default copy re-mounts in the slot.
  await page.getByTestId(`${id}-toggle`).click();
  await expect(table).toHaveAttribute('data-mode', 'default');

  // The selection survives the move…
  await expect(
    table.locator('tbody tr input[type=checkbox]:checked'),
  ).toHaveCount(2);

  // …and — the regression assertion — the card is NOT filtered down to only its
  // own selected rows: the full group set is still present and the non-selected
  // rows render dimmed.
  await expect
    .poll(async () => summaryRows(page, id).count())
    .toBe(initialRows);
  expect(await summaryRows(page, id).count()).toBeGreaterThan(2);
  await expect(table.locator('tbody tr[class*="opacity-30"]')).toHaveCount(
    initialRows - 2,
  );
}

test.describe('spec-driven dashboard', () => {
  test('(a) loads with data and no catalog race errors', async ({ page }) => {
    // Guard against the construct-before-load race: a vgplot mark constructed
    // before its derived table exists throws a DuckDB catalog error + a vgplot
    // `exclusiveFacets` TypeError. Capture page errors and console output from
    // BEFORE navigation, then assert none of the tell-tale strings appear.
    const pageErrors: Array<string> = [];
    const badConsole: Array<string> = [];
    const FORBIDDEN = ['Catalog Error', 'exclusiveFacets', 'does not exist'];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const text = message.text();
      if (FORBIDDEN.some((needle) => text.includes(needle))) {
        badConsole.push(text);
      }
    });

    await gotoDashboard(page);

    // The spec-provided title renders in the header.
    await expect(
      page.getByRole('heading', { level: 1, name: 'People Also Ask Report' }),
    ).toBeVisible();

    // Every KPI value populates with a concrete number (never the '…' loading
    // placeholder or the '—' formatter fallback).
    for (const id of KPI_VALUE_IDS) {
      await expect(page.getByTestId(id)).toHaveText(/^[\d,]+$/);
    }
    await expect(page.getByTestId('kpi-kpi_phrases-value')).toHaveText(
      TOTAL_PHRASES,
    );
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
    );

    // The vgplot histogram paints its bars.
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="vgplot-volume_brush-plot"] rect').count(),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(5);

    // Every summary table shows rows and none reports "No results.".
    for (const id of SUMMARY_IDS) {
      await expect
        .poll(async () => summaryRows(page, id).count(), { timeout: 30_000 })
        .toBeGreaterThan(0);
      await expect(page.getByTestId(id).locator('tbody')).not.toContainText(
        'No results.',
      );
    }

    // The detail table shows rows and its total matches the whole dataset.
    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect
      .poll(async () =>
        page.getByTestId('detail-detail-body').locator('tr').count(),
      )
      .toBeGreaterThan(0);

    // The regression assertion: the load produced no uncaught errors and no
    // catalog/vgplot race noise on the console.
    expect(pageErrors).toEqual([]);
    expect(badConsole).toEqual([]);
  });

  test('(b) a builder phrase filter cross-filters the page but the opt-out KPI stays constant', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const filtered = page.getByTestId('kpi-kpi_phrases-value');
    const optOut = page.getByTestId('kpi-kpi_phrases_all-value');

    // Both read count(DISTINCT phrase); they start equal on a clean load.
    await expect(filtered).toHaveText(TOTAL_PHRASES);
    await expect(optOut).toHaveText(TOTAL_PHRASES);

    // Build a Phrase filter: pick the field, confirm to add its button + open
    // its editor popover, then type a term (defaults to `contains`).
    await page.getByTestId('filter-builder-add-field').selectOption('phrase');
    await page.getByTestId('filter-builder-confirm').click();
    await expect(page.getByTestId('filter-popover-phrase')).toBeVisible();
    await page.getByTestId('filter-block-phrase-value').fill('stove');

    // The chip appears (sanitized spec id `text:phrase` → `text-phrase`).
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible();

    // The button summarizes the committed spec (operator + quoted value).
    await expect(page.getByTestId('filter-button-phrase')).toContainText(
      'contains',
    );
    await expect(page.getByTestId('filter-button-phrase')).toContainText(
      'stove',
    );

    // The cross-filtered KPI drops to a strict subset…
    await expect
      .poll(async () => readCount(filtered), { timeout: 30_000 })
      .toBeLessThan(TOTAL_PHRASES_NUM);
    expect(await readCount(filtered)).toBeGreaterThan(0);

    // …while the opt-out KPI (no `filter_by`) is byte-for-byte unchanged.
    await expect(optOut).toHaveText(TOTAL_PHRASES);

    // Clearing all filters returns the cross-filtered KPI to its original value.
    await page.getByTestId('clear-all-filters').click();
    await expect(filtered).toHaveText(TOTAL_PHRASES);
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('(c) a summary row selection cross-filters the detail table and clears', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );

    const domainRows = summaryRows(page, 'summary-table-by_domain');
    await expect.poll(async () => domainRows.count()).toBeGreaterThan(0);

    // Selecting a domain publishes a `select:domain` points spec into the page.
    await domainRows.first().click();

    const selectChip = page.locator(
      '[data-testid^="filter-chip-select-domain"]',
    );
    await expect(selectChip.first()).toBeVisible();

    // The detail table narrows to that domain's answer rows.
    await expect
      .poll(async () => readCount(page.getByTestId('detail-detail-total')), {
        timeout: 30_000,
      })
      .toBeLessThan(TOTAL_ROWS_NUM);

    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('(d) editing the spec + Apply remounts; an invalid spec shows errors and keeps the last-good dashboard', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const NEW_LABEL = 'Total Phrases (unfiltered)';

    // Open the editor and retitle the opt-out KPI.
    await page.getByTestId('spec-editor-toggle').click();
    const textarea = page.getByTestId('spec-editor-textarea');
    const original = await textarea.inputValue();
    const edited = original.replace('Phrases (all data)', NEW_LABEL);
    // Guard: the replacement actually landed (no silent no-op).
    expect(edited).not.toBe(original);
    expect(edited).toContain(NEW_LABEL);

    await textarea.fill(edited);
    await page.getByTestId('spec-editor-apply').click();

    // Apply remounts the dashboard: the new label renders and the value
    // re-populates against the reloaded data (still the unfiltered 2,681).
    await expect(page.getByTestId('kpi-kpi_phrases_all')).toContainText(
      NEW_LABEL,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );

    // The Apply remount re-hydrates the spec's defaults; clear them so the
    // cross-filtered KPI returns to its unfiltered value for the assertions below.
    await clearDefaultFilters(page);

    // A successful Apply remounts the editor (collapsed) — re-open it, then
    // apply an INVALID spec (a YAML parse error).
    await page.getByTestId('spec-editor-toggle').click();
    await page.getByTestId('spec-editor-textarea').fill('a: b: c');
    await page.getByTestId('spec-editor-apply').click();

    // Errors surface in the editor, and the last-good dashboard keeps rendering
    // its data untouched (no fetch/compile teardown).
    await expect(page.getByTestId('spec-editor-errors')).toBeVisible();
    await expect(page.getByTestId('kpi-kpi_phrases-value')).toHaveText(
      TOTAL_PHRASES,
    );
    await expect(page.getByTestId('kpi-kpi_phrases_all')).toContainText(
      NEW_LABEL,
    );
  });

  test('(e) the vgplot panel expands and collapses', async ({ page }) => {
    await gotoDashboard(page);

    const figure = page.getByTestId('vgplot-volume_brush');
    const plot = page.getByTestId('vgplot-volume_brush-plot');
    await expect(figure).toHaveAttribute('data-expanded', 'false');

    // The compact panel already paints its bars.
    await expect
      .poll(async () => plot.locator('rect').count(), { timeout: 30_000 })
      .toBeGreaterThan(5);

    // Settle the collapsed plot's box, then capture its height.
    const collapsedBox = await plot.boundingBox();
    if (collapsedBox === null) {
      throw new Error('vgplot plot box not found (collapsed)');
    }

    // Expand: the geometry grows in place (BASE_HEIGHT → EXPANDED_HEIGHT).
    await page.getByTestId('vgplot-volume_brush-toggle').click();
    await expect(figure).toHaveAttribute('data-expanded', 'true');
    await expect
      .poll(
        async () => {
          const box = await plot.boundingBox();
          return box === null ? 0 : box.height;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(collapsedBox.height);

    // Collapse: the plot returns to (approximately) its original height.
    await page.getByTestId('vgplot-volume_brush-toggle').click();
    await expect(figure).toHaveAttribute('data-expanded', 'false');
    await expect
      .poll(
        async () => {
          const box = await plot.boundingBox();
          return box === null ? Number.POSITIVE_INFINITY : box.height;
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(collapsedBox.height + 40);
  });

  test('(f) the phrase metric threshold routes HAVING to its own table and a membership subquery to its siblings', async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    const phraseRows = summaryRows(page, 'summary-table-by_phrase');
    await expect.poll(async () => phraseRows.count()).toBeGreaterThan(2);

    // Threshold the phrase card's max(search_volume) metric at > 50,000. The
    // control lives in the metric column header: open its popover, set the
    // operator + value, then explicitly Apply (no publish-per-keystroke).
    await page.getByTestId('metric-filter-by_phrase').click();
    const popover = page.getByTestId('metric-filter-by_phrase-popover');
    await expect(popover).toBeVisible();
    await page.getByTestId('metric-filter-by_phrase-op').selectOption('gt');
    await page.getByTestId('metric-filter-by_phrase-value').fill('50000');
    await page.getByTestId('metric-filter-by_phrase-apply').click();

    // The HAVING clause narrows the phrase card's own grouped query: only the
    // two 90,500-volume phrases survive.
    await expect(phraseRows).toHaveCount(2, { timeout: 30_000 });

    // The membership subquery (members:phrase, in the page context) narrows the
    // phrase KPI and the detail table to the same subset.
    await expect(page.getByTestId('kpi-kpi_phrases-value')).toHaveText('2');
    await expect
      .poll(async () => readCount(page.getByTestId('detail-detail-total')), {
        timeout: 30_000,
      })
      .toBeLessThan(TOTAL_ROWS_NUM);

    // The chip carries the HAVING badge; Clear All restores the full page.
    await expect(
      page.getByTestId('active-filter-bar').getByTestId('chip-target').first(),
    ).toHaveText('HAVING');
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('kpi-kpi_phrases-value')).toHaveText(
      TOTAL_PHRASES,
    );
    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
  });

  test('(f2) the metric threshold popover stays anchored to its trigger through page scroll', async ({
    page,
  }) => {
    await gotoDashboard(page);
    const phraseRows = summaryRows(page, 'summary-table-by_phrase');
    await expect.poll(async () => phraseRows.count()).toBeGreaterThan(2);

    const trigger = page.getByTestId('metric-filter-by_phrase');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const popover = page.getByTestId('metric-filter-by_phrase-popover');
    await expect(popover).toBeVisible();

    // Record the panel's vertical offset from its trigger at open time.
    const popoverBox = await popover.boundingBox();
    const triggerBox = await trigger.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    const gap = Math.round(popoverBox!.y - triggerBox!.y);

    // Scroll the page while the popover is open: the in-flow panel moves WITH
    // its trigger (same relative offset) instead of freezing at its open-time
    // viewport position.
    await page.evaluate(() => window.scrollBy(0, 150));
    await expect(popover).toBeVisible();
    await expect
      .poll(async () => {
        const nextPopover = await popover.boundingBox();
        const nextTrigger = await trigger.boundingBox();
        if (nextPopover === null || nextTrigger === null) {
          return null;
        }
        return Math.round(nextPopover.y - nextTrigger.y);
      })
      .toBe(gap);

    // Escape light-dismisses the panel.
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
  });

  test('(g) enlarging a summary table, selecting rows, and returning keeps the non-selected rows (by_phrase)', async ({
    page,
  }) => {
    await gotoDashboard(page);
    // by_phrase ships `expandable: true` in the on-load spec.
    await expandSelectCollapseAndAssert(page, 'summary-table-by_phrase');
  });

  test('(h) the same enlarge/select/return holds for a table made expandable through the editor (by_domain)', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Reproduce the user's exact path: add `expandable: true` to the by_domain
    // widget in the spec editor and Apply (which remounts the dashboard), then
    // run the enlarge → select → return sequence on it. Widgets are a map keyed
    // by id, so target the `by_domain:` entry's `title: Domain` line.
    await page.getByTestId('spec-editor-toggle').click();
    const textarea = page.getByTestId('spec-editor-textarea');
    const original = await textarea.inputValue();
    const edited = original.replace(
      /(\n {2}by_domain:\n {4}renderer: selection-table\n {4}title: Domain\n)/,
      '$1    expandable: true\n',
    );
    // Guard: the injection actually landed (no silent no-op).
    expect(edited).not.toBe(original);
    await textarea.fill(edited);
    await page.getByTestId('spec-editor-apply').click();

    // Apply remounts; wait for the now-expandable table's toggle to appear.
    await expect(
      page.getByTestId('summary-table-by_domain-toggle'),
    ).toBeVisible({ timeout: 90_000 });

    await expandSelectCollapseAndAssert(page, 'summary-table-by_domain');
  });

  test('(h2) first/last page buttons jump the by_phrase table to its boundary pages', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const card = page.getByTestId('summary-table-by_phrase');
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

    // 2,681 phrases / 10 per page → page 269 (index 268) is a 1-row remainder.
    const lastPage = Math.ceil(TOTAL_PHRASES_NUM / 10);

    // Wait for the full first page AND the settled unfiltered page count before
    // reading button state. The count matters: right after `gotoDashboard`
    // clears the spec defaults, the table can still hold the default-filtered
    // total (1,801 groups → 181 pages) while its unfiltered re-count is in
    // flight, and the Last button jumps to the last page of whatever count it
    // currently knows — landing on page 181 instead of 269.
    await expect(summaryRows(page, 'summary-table-by_phrase')).toHaveCount(10);
    await expect(card.getByText(`Page 1 of ${lastPage}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();
    await expect(lastButton).toBeEnabled();

    await lastButton.click();

    await expect(
      card.getByText(`Page ${lastPage} of ${lastPage}`),
    ).toBeVisible();
    await expect(summaryRows(page, 'summary-table-by_phrase')).toHaveCount(
      TOTAL_PHRASES_NUM % 10,
    );
    await expect(nextButton).toBeDisabled();
    await expect(lastButton).toBeDisabled();
    await expect(firstButton).toBeEnabled();
    await expect(prevButton).toBeEnabled();

    await firstButton.click();

    await expect(card.getByText(`Page 1 of ${lastPage}`)).toBeVisible();
    await expect(summaryRows(page, 'summary-table-by_phrase')).toHaveCount(10);
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
  });

  test('(h2b) first/last page buttons jump the detail table to its boundary pages', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const firstButton = page.getByRole('button', {
      name: 'First Detailed Breakdown page',
    });
    const prevButton = page.getByTestId('detail-detail-prev');
    const nextButton = page.getByTestId('detail-detail-next');
    const lastButton = page.getByRole('button', {
      name: 'Last Detailed Breakdown page',
    });

    // 203,556 rows / 20 per page → the last page (index 10,177) is a 16-row
    // remainder.
    const lastPage = Math.ceil(TOTAL_ROWS_NUM / 20);

    // Assert the settled unfiltered total AND page count before reading
    // button state: right after `gotoDashboard` clears the spec defaults, the
    // indicator can still reflect an in-flight window whose page count has
    // not caught up, and the Last button jumps to the last page of whatever
    // count it currently knows.
    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect(page.getByTestId('detail-detail-page')).toHaveText(
      `Page 1 of ${lastPage}`,
      { timeout: 30_000 },
    );
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();
    await expect(lastButton).toBeEnabled();

    await lastButton.click();

    await expect(page.getByTestId('detail-detail-page')).toHaveText(
      `Page ${lastPage} of ${lastPage}`,
    );
    await expect(
      page.getByTestId('detail-detail-body').locator('tr'),
    ).toHaveCount(TOTAL_ROWS_NUM % 20);
    await expect(nextButton).toBeDisabled();
    await expect(lastButton).toBeDisabled();
    await expect(firstButton).toBeEnabled();
    await expect(prevButton).toBeEnabled();

    await firstButton.click();

    await expect(page.getByTestId('detail-detail-page')).toHaveText(
      `Page 1 of ${lastPage}`,
    );
    await expect(
      page.getByTestId('detail-detail-body').locator('tr'),
    ).toHaveCount(20);
    await expect(firstButton).toBeDisabled();
    await expect(prevButton).toBeDisabled();
  });

  test('(h3) summary and detail tables expose their last-executed SQL via a header popover that dismisses', async ({
    page,
  }) => {
    await gotoDashboard(page);

    // A summary table: the panel stays mounted (hidden) until the header button
    // opens it; Escape closes it.
    const summary = page.getByTestId('summary-table-by_phrase');
    const summaryPanel = summary.getByTestId('widget-sql');
    await expect(summaryPanel).toBeHidden();
    await summary.getByTestId('widget-sql-trigger').click();
    await expect(summaryPanel).toBeVisible();
    await expect(summaryPanel.locator('pre')).toContainText('SELECT');
    await page.keyboard.press('Escape');
    await expect(summaryPanel).toBeHidden();

    // The detail table exposes its own last query the same way; an outside
    // mousedown (a KPI value is inert) closes it.
    const detail = page.getByTestId('detail-detail');
    const detailPanel = detail.getByTestId('widget-sql');
    await expect(detailPanel).toBeHidden();
    await detail.getByTestId('widget-sql-trigger').click();
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel.locator('pre')).toContainText('SELECT');
    await page.getByTestId('kpi-kpi_phrases_all-value').click();
    await expect(detailPanel).toBeHidden();
  });

  test('(i) the quick-load selector switches specs: ?spec= drives the active spec and reloads the dashboard', async ({
    page,
  }) => {
    // No param on load → the manifest `default` (questions) is the selection.
    await gotoDashboard(page);
    const select = page.getByTestId('spec-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('questions');
    // Options come only from the manifest (data), not from src/.
    await expect(select.locator('option')).toHaveCount(2);

    // Loading with ?spec=questions is identical to loading with no param
    // (defaults hydrate, then we clear to the unfiltered baseline).
    await page.goto('/?spec=questions');
    await clearDefaultFilters(page);
    await expect(page.getByTestId('kpi-kpi_questions-value')).toHaveText(
      TOTAL_QUESTIONS,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('spec-select')).toHaveValue('questions');

    // Switching the selector writes ?spec=<id> and loads that spec fresh — a
    // param-write + remount, not a no-op re-select. The `protein-design` entry
    // is a wholly different dashboard (its own tables, plots, and columns), so
    // the switch swaps the entire rendered page.
    await page.getByTestId('spec-select').selectOption('protein-design');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('protein-design');
    await expect(page.getByTestId('spec-select')).toHaveValue('protein-design');

    // The Protein Design dashboard renders its own vgplot panels (the pLDDT
    // histogram + the pLDDT×pAE scatter) and carries NO kpi widgets. The
    // histogram bars paint once the external parquet finishes downloading.
    await expect(page.getByTestId('vgplot-plddt_hist')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId('vgplot-scatter')).toBeVisible();
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="vgplot-plddt_hist-plot"] rect').count(),
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.locator('[data-testid^="kpi-"]')).toHaveCount(0);

    // Its data-table (widget id `table`) populates from the vendored parquet:
    // the total resolves to a concrete row count and the body renders rows.
    await expect(page.getByTestId('detail-table-total')).toHaveText(
      /[\d,]+ rows match/,
      { timeout: 90_000 },
    );
    await expect
      .poll(async () =>
        page.getByTestId('detail-table-body').locator('tr').count(),
      )
      .toBeGreaterThan(0);

    // Switching back restores the questions dashboard and its KPIs (defaults
    // hydrate on the reload; clear to the unfiltered baseline before asserting).
    await page.getByTestId('spec-select').selectOption('questions');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('questions');
    await clearDefaultFilters(page);
    await expect(page.getByTestId('kpi-kpi_questions-value')).toHaveText(
      TOTAL_QUESTIONS,
      { timeout: 90_000 },
    );
  });

  test('(i2) browser back after a spec switch restores the previous spec (URL + rendered dashboard)', async ({
    page,
  }) => {
    // Start on an explicit ?spec=questions entry (so the prior history entry
    // carries the param), proven loaded by its KPI (defaults cleared first).
    await page.goto('/?spec=questions');
    await clearDefaultFilters(page);
    await expect(page.getByTestId('kpi-kpi_questions-value')).toHaveText(
      TOTAL_QUESTIONS,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('spec-select')).toHaveValue('questions');

    // Switch to protein-design via the selector — a push navigation, so it lands
    // as a new history entry over the questions entry.
    await page.getByTestId('spec-select').selectOption('protein-design');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('protein-design');
    // protein-design carries NO kpi widgets and its own vgplot panels.
    await expect(page.getByTestId('vgplot-plddt_hist')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid^="kpi-"]')).toHaveCount(0);

    // Browser back returns to the questions entry: the URL param drops back to
    // questions AND the rendered dashboard is the questions one (its KPI, absent
    // from protein-design, is the spec-distinguishing element).
    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('questions');
    await expect(page.getByTestId('spec-select')).toHaveValue('questions');
    // The questions reload re-hydrates its defaults; clearing them is a no-op
    // navigation (no owned params are written), so the forward entry survives.
    await clearDefaultFilters(page);
    await expect(page.getByTestId('kpi-kpi_questions-value')).toHaveText(
      TOTAL_QUESTIONS,
      { timeout: 90_000 },
    );

    // Forward returns to protein-design, proving traversal drives both directions.
    await page.goForward();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('protein-design');
    await expect(page.getByTestId('spec-select')).toHaveValue('protein-design');
    await expect(page.getByTestId('vgplot-plddt_hist')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid^="kpi-"]')).toHaveCount(0);
  });

  test('(ii) the detail table exports the current page as CSV whose header row matches the columns', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await expect(page.getByTestId('detail-detail-total')).toHaveText(
      `${TOTAL_ROWS} rows match`,
    );
    await expect
      .poll(async () =>
        page.getByTestId('detail-detail-body').locator('tr').count(),
      )
      .toBeGreaterThan(0);

    // The `meta: { exportable: true }` on the detail widget surfaces the button.
    const exportButton = page.getByTestId('detail-detail-export');
    await expect(exportButton).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);

    const path = await download.path();
    const content = readFileSync(path, 'utf8');
    expect(content.trim().length).toBeGreaterThan(0);

    const lines = content.split('\n');
    // The header row is derived from the widget's column defs, in order.
    expect(lines[0]).toBe(
      'Domain,PAA Question,Answer Title,Answer Description',
    );
    // Header + at least one data row from the current page.
    expect(lines.length).toBeGreaterThan(1);
  });

  test('(iii) the header renders the title only — the removed subtitle never appears', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const header = page.locator('header');
    await expect(
      header.getByRole('heading', {
        level: 1,
        name: 'People Also Ask Report',
      }),
    ).toBeVisible();
    // The header carries no subtitle paragraph, and the old subtitle string is
    // gone from the document entirely.
    await expect(header.locator('p')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'Spec-driven SEO Intelligence Dashboard',
    );
  });

  test('(iv) the filter builder confirms a field into a button, opens/closes its popover, and removes it', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const confirm = page.getByTestId('filter-builder-confirm');
    const popover = page.getByTestId('filter-popover-phrase');
    const button = page.getByTestId('filter-button-phrase');

    // Confirm is disabled until a field is picked; picking one does NOT add a
    // button yet (confirm-to-add, not auto-add).
    await expect(confirm).toBeDisabled();
    await expect(button).toHaveCount(0);
    await page.getByTestId('filter-builder-add-field').selectOption('phrase');
    await expect(confirm).toBeEnabled();
    await expect(button).toHaveCount(0);

    // Confirming materializes the button and opens its editor popover; the add
    // select resets to the empty option.
    await confirm.click();
    await expect(button).toBeVisible();
    await expect(popover).toBeVisible();
    await expect(page.getByTestId('filter-builder-add-field')).toHaveValue('');

    // Escape closes the popover; the button remains (unconfigured).
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(button).toBeVisible();

    // Clicking the button re-opens it; an outside mousedown closes it again.
    await button.click();
    await expect(popover).toBeVisible();
    await page
      .getByTestId('filter-builder')
      .click({ position: { x: 2, y: 2 } });
    await expect(popover).toBeHidden();

    // Re-open and commit a value, then remove the filter from inside the
    // popover: the chip, the button, and the popover all disappear.
    await button.click();
    await page.getByTestId('filter-block-phrase-value').fill('stove');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible();
    await page.getByTestId('filter-block-phrase-remove').click();
    await expect(button).toHaveCount(0);
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId('filter-chip-text-phrase')).toHaveCount(0);
  });

  test('(v) the editor textarea handles Tab, line-move, and comment-toggle keyboard shortcuts and opens tall', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.getByTestId('spec-editor-toggle').click();
    const textarea = page.getByTestId('spec-editor-textarea');

    // The panel opens viewport-proportionally tall (h-[70vh]).
    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('viewport size unavailable');
    }
    const box = await textarea.boundingBox();
    if (box === null) {
      throw new Error('textarea box not found');
    }
    expect(box.height).toBeGreaterThan(viewport.height * 0.5);

    // Helper: set the textarea to a known draft, with the caret/selection at
    // the given offsets, so the keyboard assertions are deterministic.
    const seed = async (value: string, from: number, to: number) => {
      await textarea.fill(value);
      await textarea.evaluate(
        (element, offsets) => {
          const field = element as HTMLTextAreaElement;
          field.focus();
          field.setSelectionRange(offsets.from, offsets.to);
        },
        { from, to },
      );
    };

    // Tab inserts two spaces at the caret ("abc|def" → "abc  |def").
    await seed('abcdef', 3, 3);
    await page.keyboard.press('Tab');
    await expect(textarea).toHaveValue('abc  def');

    // Alt+ArrowDown moves the current line below its neighbor; Alt+ArrowUp
    // restores it (caret rides along with the moved line).
    await seed('line1\nline2\nline3', 8, 8);
    await page.keyboard.press('Alt+ArrowDown');
    await expect(textarea).toHaveValue('line1\nline3\nline2');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(textarea).toHaveValue('line1\nline2\nline3');

    // ControlOrMeta+/ comments the current line (a "# " after the leading
    // whitespace); pressing again uncomments it.
    await seed('  key: value', 6, 6);
    await page.keyboard.press('ControlOrMeta+/');
    await expect(textarea).toHaveValue('  # key: value');
    await page.keyboard.press('ControlOrMeta+/');
    await expect(textarea).toHaveValue('  key: value');
  });

  test('(vi) Prettify reformats valid YAML (keeping comments) and reports errors for invalid YAML; ControlOrMeta+Enter applies and the status footer tracks unsaved edits', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.getByTestId('spec-editor-toggle').click();
    const textarea = page.getByTestId('spec-editor-textarea');
    const status = page.getByTestId('spec-editor-status');

    // The status footer reports the caret position and starts with no unsaved
    // marker (the draft equals the applied text on open).
    await expect(status).toContainText('Ln');
    await expect(status).not.toContainText('Unsaved changes');

    // Prettify a valid-but-messy draft: the over-indented mapping normalizes to
    // two spaces AND the inline comment survives (document-mode stringify).
    await textarea.fill('a:\n      b: 1   # keep me\n');
    await expect(status).toContainText('Unsaved changes');
    await page.getByTestId('spec-editor-prettify').click();
    await expect(textarea).toHaveValue('a:\n  b: 1 # keep me\n');
    await expect(page.getByTestId('spec-editor-errors')).toHaveCount(0);

    // Prettify invalid YAML: an error surfaces and the text is left untouched.
    await textarea.fill('a: [');
    await page.getByTestId('spec-editor-prettify').click();
    await expect(page.getByTestId('spec-editor-errors')).toBeVisible();
    await expect(textarea).toHaveValue('a: [');

    // ControlOrMeta+Enter runs the same Apply handler as the button: retitle the
    // dashboard through a keyboard-applied draft (mirrors test (d)).
    const NEW_TITLE = 'Edited Via Keyboard';
    await page.getByTestId('spec-editor-reset').click();
    const original = await textarea.inputValue();
    const edited = original.replace('People Also Ask Report', NEW_TITLE);
    expect(edited).not.toBe(original);
    await textarea.fill(edited);
    await expect(status).toContainText('Unsaved changes');

    await textarea.focus();
    await page.keyboard.press('ControlOrMeta+Enter');

    // Apply remounts the dashboard with the new title (and collapses the editor).
    await expect(
      page.getByRole('heading', { level: 1, name: NEW_TITLE }),
    ).toBeVisible({ timeout: 90_000 });

    // Re-opening the editor after Apply shows the applied text as the draft, so
    // the unsaved indicator is absent again.
    await page.getByTestId('spec-editor-toggle').click();
    await expect(page.getByTestId('spec-editor-status')).not.toContainText(
      'Unsaved changes',
    );
  });

  test('(p1) confirming a builder filter writes its persisted param; removing it deletes the param', async ({
    page,
  }) => {
    // Unfiltered baseline (defaults cleared) — no owned params on the URL yet.
    await gotoDashboard(page);
    await expect
      .poll(() => new URL(page.url()).searchParams.has('f.text:phrase'))
      .toBe(false);

    // With no params at all, the URL-params popover shows its empty state.
    await page.getByTestId('url-params-button').click();
    await expect(page.getByTestId('url-params-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('url-params-panel')).toBeHidden();

    // Build a Phrase filter (default operator `contains` → bare value form).
    await page.getByTestId('filter-builder-add-field').selectOption('phrase');
    await page.getByTestId('filter-builder-confirm').click();
    await page.getByTestId('filter-block-phrase-value').fill('stove');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible();

    // The prefixed param is written with the encoded value.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('f.text:phrase'))
      .toBe('stove');

    // Removing the filter deletes its param (foreign/spec params untouched).
    await page.getByTestId('filter-block-phrase-remove').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has('f.text:phrase'))
      .toBe(false);
  });

  test('(p2) a shared link with filter params hydrates the dashboard filtered (URL wins over defaults)', async ({
    page,
  }) => {
    // Load directly with an owned param: the URL wins wholesale, so the declared
    // defaults are NOT merged in.
    await page.goto('/?spec=questions&f.text:phrase=stove');

    // The opt-out KPI proves the pipeline loaded; the cross-filtered KPI is a
    // strict subset — the filter was hydrated before the first query (no flash
    // back up to the full value is assertable here).
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );
    await expect
      .poll(async () => readCount(page.getByTestId('kpi-kpi_phrases-value')), {
        timeout: 30_000,
      })
      .toBeLessThan(TOTAL_PHRASES_NUM);

    // The active-filter chip renders, and the default was NOT merged in.
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible();
    await expect(page.getByTestId('filter-chip-facet-domain')).toHaveCount(0);
  });

  test('(p2b) StrictMode bootstrap does not delete an owned malformed parameter', async ({
    page,
  }) => {
    // The empty value is owned by the filter registry but fails its text codec.
    // Hydration ignores it and, importantly, the write-back effect's StrictMode
    // setup replay must not mistake that ignored bootstrap for a runtime clear.
    await page.goto('/?spec=questions&f.text%3Aphrase=');
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return (
          params.has('f.text:phrase') && params.get('f.text:phrase') === ''
        );
      })
      .toBe(true);
  });

  test('(p3) a bare URL hydrates the spec-declared defaults', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );

    // The declared default surfaces its chip: the domain facet placement.
    await expect(page.getByTestId('filter-chip-facet-domain')).toBeVisible();

    // The default domain list cross-filters the phrase KPI below the total.
    await expect
      .poll(async () => readCount(page.getByTestId('kpi-kpi_phrases-value')), {
        timeout: 30_000,
      })
      .toBeLessThan(TOTAL_PHRASES_NUM);

    // The default hydrates from the bare URL, then materializes into it once
    // the builder block re-registers the spec with its session-scoped
    // self-exclusion clients — so the hydrated default view is itself a
    // shareable link. The params popover badges it as an owned filter param.
    await expect
      .poll(() => new URL(page.url()).searchParams.has('f.facet:domain'), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.getByTestId('url-params-button').click();
    await expect(page.getByTestId('url-param-f.facet:domain')).toHaveAttribute(
      'data-ownership',
      'filter',
    );
  });

  test('(p4) clear-all removes the owned params and a reload restores the defaults', async ({
    page,
  }) => {
    await page.goto('/?spec=questions&f.text:phrase=stove');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible({
      timeout: 90_000,
    });

    // Clear-all removes the owned param (the app `spec` param is preserved).
    await page.getByTestId('clear-all-filters').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has('f.text:phrase'))
      .toBe(false);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('questions');
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);

    // Reload the now-bare URL: the declared defaults hydrate again.
    await page.reload();
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('filter-chip-facet-domain')).toBeVisible();
    await expect(page.getByTestId('filter-chip-text-phrase')).toHaveCount(0);
  });

  test('(p5) switching specs nukes every non-spec param', async ({ page }) => {
    // Load questions with an owned filter param AND a foreign param.
    await page.goto('/?spec=questions&f.text:phrase=stove&foo=bar');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible({
      timeout: 90_000,
    });

    // Switching specs writes `?spec=<id>` and nulls every other current param.
    await page.getByTestId('spec-select').selectOption('protein-design');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('protein-design');
    await expect
      .poll(() => [...new URL(page.url()).searchParams.keys()].sort())
      .toEqual(['spec']);
  });

  test('(p6) the URL-params popover lists params with ownership badges and copies the link', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?spec=questions&f.text:phrase=stove');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible({
      timeout: 90_000,
    });

    await page.getByTestId('url-params-button').click();
    await expect(page.getByTestId('url-params-panel')).toBeVisible();

    // The `spec` param is badged as the app param; the persisted filter param is
    // badged `filter` and its value decodes to the human-readable form.
    await expect(page.getByTestId('url-param-spec')).toHaveAttribute(
      'data-ownership',
      'spec',
    );
    const filterRow = page.getByTestId('url-param-f.text:phrase');
    await expect(filterRow).toHaveAttribute('data-ownership', 'filter');
    await expect(filterRow).toContainText('stove');

    // Copy link flips the button to its brief confirmation state.
    await page.getByTestId('url-params-copy').click();
    await expect(page.getByTestId('url-params-copy')).toHaveText('Copied');
  });

  test('(p7) clearing hydrated defaults restores the FULL unfiltered histogram domain, and brushing does not rescale it', async ({
    page,
  }) => {
    // Repro of the poisoned `x_domain: fixed` bug: the defaults hydrate BEFORE
    // the first histogram query, so a `Fixed` (freeze-on-first-render) domain
    // would lock to the filtered (>=10k) extent. `gotoDashboard` loads with the
    // defaults hydrated, then clears them — the exact reported reproduction.
    await gotoDashboard(page);
    const plot = page.getByTestId('vgplot-volume_brush-plot');
    await expect
      .poll(async () => plot.locator('rect').count(), { timeout: 30_000 })
      .toBeGreaterThan(3);

    // The tallest bar spans most of the plot height: the large low-volume bin is
    // VISIBLE. Under the bug that bin fell outside the frozen >=10k domain, so
    // every remaining bar was squashed into a flat strip (heights ~a dozen px
    // against a y-axis inflated to ~30,000).
    const tallestBar = async () =>
      plot
        .locator('rect')
        .evaluateAll((rects) =>
          rects.reduce(
            (max, rect) =>
              Math.max(max, Number(rect.getAttribute('height') ?? 0)),
            0,
          ),
        );
    await expect.poll(tallestBar, { timeout: 30_000 }).toBeGreaterThan(80);

    // The x-axis exposes the LOW end of the range (a plain tick <= 100), proving
    // the domain is the full unfiltered extent, not the filtered >=10k one.
    const hasLowTick = async () =>
      (await plot.locator('svg text').allTextContents()).some((text) => {
        const trimmed = text.trim();
        return /^\d+$/.test(trimmed) && Number(trimmed) <= 100;
      });
    await expect.poll(hasLowTick).toBe(true);

    // Brushing still works with the explicit domain AND does not rescale it.
    // Record the sorted axis tick labels, brush a sub-range with a real drag,
    // then assert the brush committed (the strip leaves its placeholder) while
    // the histogram's own tick labels are byte-for-byte unchanged.
    const sortedTicks = async () =>
      (await plot.locator('svg text').allTextContents())
        .map((text) => text.trim())
        .sort()
        .join('|');

    // The clear-all above can retrigger a plot rebuild (layout/scrollbar width
    // shifts feed the widget's ResizeObserver), briefly detaching the svg and
    // re-deriving ticks. Wait until the tick set is stable across consecutive
    // reads before recording the baseline the no-rescale assertion compares to.
    let lastTicks = '';
    await expect
      .poll(
        async () => {
          const now = await sortedTicks();
          const stable = now !== '' && now === lastTicks;
          lastTicks = now;
          return stable;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const ticksBefore = lastTicks;

    // The svg can detach mid-read during a rebuild; retry until a box resolves.
    const resolveBox = async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const candidate = await plot.locator('svg').boundingBox();
        if (candidate !== null) {
          return candidate;
        }
        await page.waitForTimeout(500);
      }
      throw new Error('vgplot plot svg box not found');
    };
    const box = await resolveBox();
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.45, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, midY, { steps: 10 });
    await page.mouse.up();

    // The brush published a committed range (the strip leaves its placeholder).
    await expect(page.getByTestId('vgplot-volume_brush-range')).not.toHaveText(
      'Full range — drag to brush',
      { timeout: 15_000 },
    );

    // The fixed domain did not rescale under the brush (self-exclusion keeps the
    // histogram unfiltered by its own brush, and the domain is frozen).
    expect(await sortedTicks()).toBe(ticksBefore);
  });

  test('(p8) a shared selection link hydrates before queries and is identified as selection state', async ({
    page,
  }) => {
    // The malformed owned FilterSet value suppresses declared FilterSet
    // defaults, isolating the persisted volume selection for this direct load.
    await page.goto(
      '/?spec=questions&f.text%3Aphrase=&s.volume_brush=10000..1000000',
    );
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );

    // The construction-time selection is already part of the topology read by
    // the first query clients: it surfaces as a chip and filters the page.
    await expect(page.getByTestId('filter-chip-volume_brush')).toBeVisible();
    await expect
      .poll(async () => readCount(page.getByTestId('detail-detail-total')), {
        timeout: 30_000,
      })
      .toBeLessThan(TOTAL_ROWS_NUM);

    // Both renderer-local interactors adopt the topology value before their
    // first paint, even though neither renderer owns persistence.
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush'))
      .toBeGreaterThan(0);
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush_mirror'))
      .toBeGreaterThan(0);
    await expect.poll(() => brushSelectionsMatch(page)).toBe(true);

    await page.getByTestId('url-params-button').click();
    const row = page.getByTestId('url-param-s.volume_brush');
    await expect(row).toHaveAttribute('data-ownership', 'selection');
    await expect(row).toContainText('10000 – 1000000');
  });

  test('(p9) selection writes use the React URL boundary and clear atomically with FilterSet state', async ({
    page,
  }) => {
    const navigationErrors: Array<string> = [];
    page.on('pageerror', (error) => {
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        navigationErrors.push(error.message);
      }
    });
    await gotoDashboard(page);
    await brushVolumePlot(page);

    await expect(page.getByTestId('filter-chip-volume_brush')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('s.volume_brush'))
      .toMatch(/^-?\d+(?:\.\d+)?\.\.-?\d+(?:\.\d+)?$/);
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush_mirror'))
      .toBeGreaterThan(0);
    await expect.poll(() => brushSelectionsMatch(page)).toBe(true);

    // A chip removal clears the live Mosaic source and then deletes its owned
    // selection parameter through the same hook-owned write boundary.
    await page
      .getByTestId('filter-chip-volume_brush')
      .getByRole('button')
      .click();
    await expect(page.getByTestId('filter-chip-volume_brush')).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.has('s.volume_brush'))
      .toBe(false);

    await expect.poll(() => brushSelectionWidth(page, 'volume_brush')).toBe(0);
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush_mirror'))
      .toBe(0);

    // Brush the mirror next: the primary plot adopts its sibling's value. Then
    // recreate both URL domains and clear them together. A single merged patch
    // prevents adjacent Selection / FilterSet notification waves from restoring
    // the other domain's stale parameter.
    await brushVolumePlot(page, 'volume_brush_mirror');
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush'))
      .toBeGreaterThan(0);
    await expect.poll(() => brushSelectionsMatch(page)).toBe(true);
    await page.getByTestId('filter-builder-add-field').selectOption('phrase');
    await page.getByTestId('filter-builder-confirm').click();
    await page.getByTestId('filter-block-phrase-value').fill('stove');
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return params.has('s.volume_brush') && params.has('f.text:phrase');
      })
      .toBe(true);

    await page.getByTestId('clear-all-filters').click();
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return !params.has('s.volume_brush') && !params.has('f.text:phrase');
      })
      .toBe(true);
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
    await expect.poll(() => brushSelectionWidth(page, 'volume_brush')).toBe(0);
    await expect
      .poll(() => brushSelectionWidth(page, 'volume_brush_mirror'))
      .toBe(0);
    expect(navigationErrors).toEqual([]);
  });

  test('(p10) malformed selection state remains unclaimed during bootstrap writes', async ({
    page,
  }) => {
    await page.goto('/?spec=questions&s.volume_brush=not-a-range');
    await expect(page.getByTestId('kpi-kpi_phrases_all-value')).toHaveText(
      TOTAL_PHRASES,
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('filter-chip-volume_brush')).toHaveCount(0);

    // FilterSet defaults may materialize their own URL state after mount. The
    // merged selection patch still omits this never-valid entry, preserving the
    // hand-edited malformed value rather than silently deleting it.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('s.volume_brush'))
      .toBe('not-a-range');
  });

  test('(p11) detail filter typing keeps focus and debounces the final URL value', async ({
    page,
  }) => {
    const navigationErrors: Array<string> = [];
    page.on('pageerror', (error) => {
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        navigationErrors.push(error.message);
      }
    });
    await gotoDashboard(page);

    const input = page.getByTestId('detail-detail-filter-domain');
    await input.click();
    const original = await input.elementHandle();
    if (original === null) {
      throw new Error('detail domain filter input was not found');
    }
    let expected = '';
    for (const character of 'stove') {
      expected += character;
      await page.keyboard.type(character);
      await expect(input).toHaveValue(expected);
      expect(
        await input.evaluate((element) => document.activeElement === element),
      ).toBe(true);
      await page.waitForTimeout(60);
    }

    // The hook classifies FilterSet changes as debounced URL work: the final
    // keystroke is visible in local/Mosaic state, but has not navigated yet.
    expect(new URL(page.url()).searchParams.has('f.detail:domain')).toBe(false);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('f.detail:domain'))
      .toBe('stove');
    expect(
      await input.evaluate((element) => document.activeElement === element),
    ).toBe(true);
    expect(
      await input.evaluate((element, first) => element === first, original),
    ).toBe(true);
    expect(navigationErrors).toEqual([]);
  });

  test('(p12) switching specs cancels a queued filter URL commit', async ({
    page,
  }) => {
    await gotoDashboard(page);
    const input = page.getByTestId('detail-detail-filter-domain');
    await input.fill('stove');
    await expect(input).toHaveValue('stove');
    await page.waitForTimeout(50);
    expect(new URL(page.url()).searchParams.has('f.detail:domain')).toBe(false);

    // Switch inside the debounce window. Commit-phase cancellation must prevent
    // the old topology's timer from merging its filter into the new spec URL.
    await page.getByTestId('spec-select').selectOption('protein-design');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('spec'))
      .toBe('protein-design');
    await page.waitForTimeout(500);
    expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual([
      'spec',
    ]);
  });

  test('(p13) protein intervalXY brush persists, restores, and clears atomically', async ({
    page,
  }) => {
    await page.goto('/?spec=protein-design&s.scatter_brush=70..90,0..20');
    await expect(page.getByTestId('detail-table-total')).toHaveText(
      '3,721 rows match',
      { timeout: 90_000 },
    );
    await expect(page.getByTestId('filter-chip-scatter_brush')).toBeVisible();
    await expect
      .poll(async () => {
        const geometry = await scatterBrushGeometry(page);
        return geometry.width > 0 && geometry.height > 0;
      })
      .toBe(true);

    await page.getByTestId('url-params-button').click();
    const urlRow = page.getByTestId('url-param-s.scatter_brush');
    await expect(urlRow).toHaveAttribute('data-ownership', 'selection');
    await expect(urlRow).toContainText('plddt_total: 70 – 90');
    await expect(urlRow).toContainText('pae_interaction: 0 – 20');
    await page.keyboard.press('Escape');

    // Removing the hydrated chip deletes the one atomic rectangle parameter
    // and clears the renderer-local 2D brush.
    await page
      .getByTestId('filter-chip-scatter_brush')
      .getByRole('button')
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has('s.scatter_brush'))
      .toBe(false);
    await expect
      .poll(async () => {
        const geometry = await scatterBrushGeometry(page);
        return geometry.width === 0 && geometry.height === 0;
      })
      .toBe(true);

    // A real diagonal drag writes the renderer-neutral nested grammar. Reload
    // proves the URL reconstructs both the Mosaic clause and the 2D overlay.
    await brushProteinScatter(page);
    const token = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:e[+-]?\\d+)?';
    const rectanglePattern = new RegExp(
      `^${token}\\.\\.${token},${token}\\.\\.${token}$`,
      'i',
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get('s.scatter_brush'))
      .toMatch(rectanglePattern);
    const persisted = new URL(page.url()).searchParams.get('s.scatter_brush');
    expect(persisted).not.toBeNull();

    await page.reload();
    await expect(page.getByTestId('filter-chip-scatter_brush')).toBeVisible({
      timeout: 90_000,
    });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('s.scatter_brush'))
      .toBe(persisted);
    await expect
      .poll(async () => {
        const geometry = await scatterBrushGeometry(page);
        return geometry.width > 0 && geometry.height > 0;
      })
      .toBe(true);

    await page.getByTestId('clear-all-filters').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has('s.scatter_brush'))
      .toBe(false);
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
  });

  test('(x1) a per-widget `exclude` ignores the domain filter but still honors the others', async ({
    page,
  }) => {
    // Load a BARE url (no `clearDefaultFilters`) so the spec-declared
    // `facet:domain` default hydrates ACTIVE — the five major answer domains.
    // That hydrated default IS the `facet:domain` spec that
    // `kpi_phrases_no_domain` names in its `exclude`, so it is the real filter
    // whose exclusion we prove — NOT the `select:domain` a summary-row click
    // publishes (test (c)), which no widget excludes.
    await page.goto('/');

    const fullyFiltered = page.getByTestId('kpi-kpi_phrases-value'); // honors every filter
    const noDomain = page.getByTestId('kpi-kpi_phrases_no_domain-value'); // excludes facet:domain only
    const optOut = page.getByTestId('kpi-kpi_phrases_all-value'); // no filter_by at all

    // The opt-out KPI (no `filter_by`) is a dataset constant, so its full value
    // proves the whole pipeline (spec fetch → compile → topology → load → query)
    // is up before any assertion; the chip proves the domain default hydrated.
    await expect(optOut).toHaveText(TOTAL_PHRASES, { timeout: 90_000 });
    await expect(page.getByTestId('filter-chip-facet-domain')).toBeVisible();

    // ── Semantic 1: with ONLY the domain filter active, the fully-filtered KPI
    // drops to a strict subset (its count(DISTINCT phrase) is scoped to the five
    // domains) while the exclude-domain KPI IGNORES `facet:domain` and reads the
    // full total — byte-for-byte identical to the true opt-out card. This is the
    // partial-vs-full contrast: excluding one filter leaves the widget unfiltered
    // here precisely because domain is the only active filter.
    await expect
      .poll(async () => readCount(fullyFiltered), { timeout: 30_000 })
      .toBeLessThan(TOTAL_PHRASES_NUM);
    expect(await readCount(fullyFiltered)).toBeGreaterThan(0);
    await expect(noDomain).toHaveText(TOTAL_PHRASES);
    await expect(optOut).toHaveText(TOTAL_PHRASES);

    // Baseline for the drop-below assertion: with domain excluded and no other
    // filter yet, the exclude-domain KPI sits at the full unfiltered total.
    const noDomainBefore = await readCount(noDomain);
    expect(noDomainBefore).toBe(TOTAL_PHRASES_NUM);

    // ── Add a NON-domain filter (phrase contains 'stove') ON TOP of the domain
    // default — same builder path as test (b): pick the field, confirm to add
    // its button + editor, then type the term (defaults to `contains`).
    await page.getByTestId('filter-builder-add-field').selectOption('phrase');
    await page.getByTestId('filter-builder-confirm').click();
    await expect(page.getByTestId('filter-popover-phrase')).toBeVisible();
    await page.getByTestId('filter-block-phrase-value').fill('stove');
    await expect(page.getByTestId('filter-chip-text-phrase')).toBeVisible();

    // ── Semantic 2: the exclude-domain KPI HONORS the phrase filter, so it drops
    // strictly below its full-total baseline — this is what distinguishes
    // exclude-ONE (`exclude: [facet:domain]`) from exclude-ALL (no `filter_by`).
    // Its post value is count(DISTINCT phrase) of `contains 'stove'` across ALL
    // domains — the exact quantity test (b) asserts is a nonzero strict subset.
    await expect
      .poll(async () => readCount(noDomain), { timeout: 30_000 })
      .toBeLessThan(noDomainBefore);
    expect(await readCount(noDomain)).toBeGreaterThan(0);

    // …while the true opt-out KPI (no `filter_by`) stays pinned to the full
    // total, honoring nothing — the exclude-domain card is NOT this.
    await expect(optOut).toHaveText(TOTAL_PHRASES);

    // The fully-filtered KPI honors BOTH the domain default AND the phrase
    // filter, so its phrase-matching phrases are constrained to the five domains
    // — a subset of the exclude-domain KPI's all-domain phrase matches.
    expect(await readCount(fullyFiltered)).toBeLessThanOrEqual(
      await readCount(noDomain),
    );

    // ── Semantic 3: clearing every filter (domain default + phrase) restores all
    // three KPIs to the full unfiltered total and empties the active-filter bar.
    await page.getByTestId('clear-all-filters').click();
    await expect(page.getByTestId('active-filter-bar')).toHaveCount(0);
    await expect(fullyFiltered).toHaveText(TOTAL_PHRASES);
    await expect(noDomain).toHaveText(TOTAL_PHRASES);
    await expect(optOut).toHaveText(TOTAL_PHRASES);
  });
});
