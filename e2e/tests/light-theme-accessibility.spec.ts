import { expect, test, type Locator, type Page } from '@playwright/test';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: number[]): number {
  return (0.2126 * channel(red)) + (0.7152 * channel(green)) + (0.0722 * channel(blue));
}

function parseRgb(value: string): number[] {
  const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  return match.slice(1).map(Number);
}

async function contrastRatio(locator: Locator): Promise<number> {
  const { color, backgroundColor } = await locator.evaluate((element) => {
    let current: Element | null = element;
    let backgroundColor = '';
    while (current) {
      const candidate = getComputedStyle(current).backgroundColor;
      if (candidate !== 'transparent' && !candidate.endsWith(', 0)')) {
        backgroundColor = candidate;
        break;
      }
      current = current.parentElement;
    }
    return { color: getComputedStyle(element).color, backgroundColor };
  });
  const foreground = luminance(parseRgb(color));
  const background = luminance(parseRgb(backgroundColor));
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}

async function useLightTheme(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
}

test.describe('Light-theme readability', () => {
  test('uses readable green for block heights on mobile', async ({ page }) => {
    await useLightTheme(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/stats/summary', (route) => route.fulfill({
      json: { tipHeight: 9_311_455, isSyncing: false, inconsistentBlocks: 0 },
    }));
    await page.route('**/api/blocks?*', (route) => route.fulfill({
      json: [{
        height: 9_311_455,
        hash: '916dddc464d00000000000000000000000000000000000000000000000702675',
        timestamp: new Date().toISOString(),
        txCount: 0,
        gasUsed: '0',
      }],
    }));

    await page.goto('/blocks');
    const blockHeight = page.getByText('9,311,455', { exact: true }).last();
    await expect(blockHeight).toBeVisible();
    expect(await contrastRatio(blockHeight)).toBeGreaterThanOrEqual(4.5);
  });

  test('keeps Quantt content readable in light mode', async ({ page }) => {
    await useLightTheme(page);
    await page.route('**/api/quantt/status', (route) => route.fulfill({
      json: { configured: false, researchUrl: 'https://research.quantt.at/', developerUrl: 'https://dev.quantts.ai/' },
    }));

    await page.goto('/quantt');
    const heading = page.getByRole('heading', { name: 'AI market research' });
    const description = page.getByText('Query approved Quantt insights through the Lithosphere API. Provider credentials remain server-side.');
    await expect(heading).toBeVisible();
    expect(await contrastRatio(heading)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(description)).toBeGreaterThanOrEqual(4.5);
  });
});
