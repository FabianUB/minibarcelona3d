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
  const legendPanel = page.getByTestId('legend-panel');
  if (await legendPanel.isVisible().catch(() => false)) {
    return legendPanel;
  }
  const legendToggle = page.getByRole('button', { name: /legend/i });
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

test.describe('Legend identification timing', () => {
  test('highlights a selected line within 10 seconds for SC-002 evidence', async ({
    page,
  }) => {
    const legendEntries = await fetchLegendEntries(page);
    const entryUnderTest = legendEntries[0];

    await page.goto('/');
    const legendPanel = await ensureLegendPanelVisible(page);
    const entryButton = legendPanel.getByTestId(
      `legend-entry-${entryUnderTest.line_id}`,
    );

    await expect(
      entryButton,
      `legend entry ${entryUnderTest.line_id} should be visible for interaction`,
    ).toBeVisible();

    const start = Date.now();
    await entryButton.click();

    await expect(
      entryButton,
      'legend entry should transition to pressed state to confirm selection',
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    const elapsed = Date.now() - start;
    expect.soft(
      elapsed,
      'legend highlight should complete within the SC-002 10 second threshold',
    ).toBeLessThanOrEqual(10_000);

    const statusBanner = page.getByTestId('legend-selection-status');
    await expect(
      statusBanner,
      'status banner should acknowledge the highlighted line',
    ).toContainText(entryUnderTest.label, { timeout: 2_000 });
  });
});

