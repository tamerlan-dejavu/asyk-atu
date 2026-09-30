import { expect, test } from '@playwright/test';

test('навес: выбрать высоту, бросок, попытки уменьшились, ошибок нет', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_vercel')) errors.push(m.text());
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem(
      'asyk-atu:v1',
      JSON.stringify({
        v: 2,
        lang: 'ru',
        sound: false,
        quality: 'low',
        tutorialDone: true,
        unlocked: 8,
        seenHints: ['golden', 'heavy', 'block', 'loft'],
      }),
    );
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/?ruleset=loft');
  await page.locator('[data-act="play"]').click();
  await page.locator('[data-act="level"][data-arg="8"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING', undefined, { timeout: 30_000 });
  await page.locator('[data-act="loftSet"][data-arg="high"]').click();
  await expect(page.locator('[data-act="loftSet"][data-arg="high"]')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => (window as any).__asyk.throwsLeft as number);
  const box = (await page.locator('#game canvas').first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.78;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height * 0.08, { steps: 8 });
  await page.screenshot({ path: 'test-results/loft-aim.png' });
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING');
  await page.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE'].includes((window as any).__asyk?.state), undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as any).__asyk.throwsLeft)).toBe(before - 1);
  expect(errors).toEqual([]);
});
