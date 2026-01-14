import type { Page } from '@playwright/test';

type View = 'athletes-simple' | 'athletes' | 'nyc-taxi' | 'nozzle-paa';

export function getInit(view: View) {
  return (page: Page) => page.goto('/?dashboard=' + view);
}
