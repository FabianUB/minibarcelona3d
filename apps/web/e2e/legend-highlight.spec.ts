import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { LegendEntry } from '../src/types/rodalies';

async function fetchLegendEntries(page: Page): Promise<LegendEntry[]> {
  const manifestResponse = await page.request.get('/rodalies_data/manifest.json');
  if (!manifestResponse.ok()) {
    throw new Error('Failed to load Rodalies manifest for legend data');
  }
  const manifest = (await manifestResponse.json()) as {
    legend_entries_path?: string;
  };
  const legendPath = manifest.legend_entries_path;
  if (!legendPath) {
    throw new Error('Legend entries path missing from manifest');
  }
  const sanitisedPath = legendPath.startsWith('/')
    ? legendPath
    : legendPath.startsWith('rodalies_data/')
      ? `/${legendPath}`
      : `/rodalies_data/${legendPath}`;
  const legendResponse = await page.request.get(sanitisedPath);
  if (!legendResponse.ok()) {
    throw new Error(`Failed to load legend entries from ${sanitisedPath}`);
  }
  const entries = (await legendResponse.json()) as LegendEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Legend entries payload is empty');
  }
  return entries;
}

async function ensureLegendPanelVisible(page: Page): Promise<Locator> {
  const legendPanel = page.getByTestId('rodalies-legend');
  if (await legendPanel.isVisible().catch(() => false)) {
    return legendPanel;
  }
  const legendToggle = page.getByTestId('legend-toggle-button');
  await expect(
    legendToggle,
    'legend toggle button should be available when panel is hidden',
  ).toBeVisible();
  await legendToggle.click();
  await expect(
    legendPanel,
    'legend panel should become visible after clicking the toggle',
  ).toBeVisible();
  return legendPanel;
}

test.describe('Legend highlight toggles', () => {
  test('allows toggling a single line highlight on and off', async ({ page }) => {
    const legendEntries = await fetchLegendEntries(page);
    const entryUnderTest = legendEntries[0];

    await page.goto('/');

    const legendPanel = await ensureLegendPanelVisible(page);

    const entryButton = legendPanel.getByTestId(
      `legend-entry-${entryUnderTest.line_id}`,
    );

    await expect(
      entryButton,
      `legend entry ${entryUnderTest.line_id} should be present`,
    ).toBeVisible();

    await expect(
      entryButton,
      'legend entry should expose pressed state before activation',
    ).toHaveAttribute('aria-pressed', 'false');

    await entryButton.click();
    await expect(
      entryButton,
      'legend entry should report pressed state after highlighting',
    ).toHaveAttribute('aria-pressed', 'true');

    const statusBanner = page.getByTestId('legend-selection-status');
    await expect(
      statusBanner,
      'legend should surface a status message when a line is highlighted',
    ).toContainText(entryUnderTest.label);

    await entryButton.click();
    await expect(
      entryButton,
      'legend entry should reset pressed state after toggling off',
    ).toHaveAttribute('aria-pressed', 'false');
  });
});

