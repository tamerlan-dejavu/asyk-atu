import { expect, test, type Page } from '@playwright/test';

/** Ошибки консоли; сетевые сбои внешней аналитики Vercel игру не касаются и не считаются. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_vercel')) errors.push(m.text());
  });
  return errors;
}

async function seed(page: Page): Promise<void> {
  // пропускаем обучение, чтобы сразу попасть на выбор испытаний
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem(
      'asyk-atu:v1',
      JSON.stringify({ v: 1, lang: 'ru', sound: false, quality: 'low', tutorialDone: true, unlocked: 1 }),
    );
    sessionStorage.setItem('seeded', '1');
  });
}

const state = (page: Page) => page.evaluate(() => (window as any).__asyk?.state as string | undefined);

async function oneThrow(page: Page): Promise<{ before: number; after: number }> {
  await page.locator('[data-act="play"]').click();
  await page.locator('[data-act="level"][data-arg="1"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING');
  const before = await page.evaluate(() => (window as any).__asyk.throwsLeft as number);

  const box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height * 0.12, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING');
  await page.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE'].includes((window as any).__asyk?.state), undefined, { timeout: 60_000 });
  const after = await page.evaluate(() => (window as any).__asyk.throwsLeft as number);
  return { before, after };
}

test('открыть → Играть → уровень 1 → бросок → счётчик бросков уменьшился', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const { before, after } = await oneThrow(page);
  expect(after).toBe(before - 1);
  expect(await state(page)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('без сети игра работает и не пишет ошибок', async ({ page, context }) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto('/');
  await context.setOffline(true);
  const { before, after } = await oneThrow(page);
  expect(after).toBe(before - 1);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
