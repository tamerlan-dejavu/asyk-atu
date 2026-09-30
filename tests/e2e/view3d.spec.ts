import { expect, test, type Page } from '@playwright/test';

// Программный WebGL (SwiftShader): цифры FPS здесь ничего не значат, поэтому ?fpsguard=0
// отключает автоматический откат в 2D по FPS.
const URL = '/?fpsguard=0';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_vercel')) errors.push(m.text());
  });
  return errors;
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem(
      'asyk-atu:v1',
      JSON.stringify({ v: 2, lang: 'ru', sound: false, quality: 'low', tutorialDone: true, unlocked: 2 }),
    );
    sessionStorage.setItem('seeded', '1');
  });
}

const has3d = (page: Page) => page.evaluate(() => Boolean((window as any).__asyk3d));

test('3D: страница загружается, два canvas, бросок уменьшает попытки', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await seed(page);
  await page.goto(URL);
  await page.waitForFunction(() => Boolean((window as any).__asyk3d), undefined, { timeout: 30_000 });
  await expect(page.locator('#game canvas')).toHaveCount(2);
  await page.locator('[data-act="play"]').click();
  await page.locator('[data-act="level"][data-arg="1"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING', undefined, { timeout: 30_000 });
  const before = await page.evaluate(() => (window as any).__asyk.throwsLeft as number);
  const box = (await page.locator('#game canvas:not(.three-canvas)').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height * 0.1, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING');
  await page.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE'].includes((window as any).__asyk?.state), undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as any).__asyk.throwsLeft)).toBe(before - 1);
  expect(await has3d(page)).toBe(true);
  expect(errors).toEqual([]);
});
