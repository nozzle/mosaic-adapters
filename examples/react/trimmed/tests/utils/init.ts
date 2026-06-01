import type { Page } from '@playwright/test';

type View =
  | 'aggregate-filter-lab'
  | 'athletes-simple'
  | 'athletes'
  | 'filter-builder'
  | 'nyc-taxi'
  | 'nozzle-paa';

export function getInit(view: View) {
  return (page: Page) =>
    page.goto('/?dashboard=' + view, { waitUntil: 'networkidle' });
}
