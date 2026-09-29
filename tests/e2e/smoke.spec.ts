/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';

test('открыть → Играть → уровень 1 → бросок → счётчик бросков уменьшился', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // пропускаем обучение, чтобы сразу попасть на выбор испытаний
  await page.addInitScript(() => {
    localStorage.setItem(
      'asyk-atu:v1',
      JSON.stringify({ v: 1, lang: 'ru', sound: false, quality: 'high', tutorialDone: true, unlocked: 1 }),
    );
  });
  await page.goto('/');
  await page.locator('[data-act="play"]').click();
  await page.locator('[data-act="level"][data-arg="1"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING');
  const before = await page.evaluate(() => (window as any).__asyk.throwsLeft);

  const box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height * 0.12, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING');
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING' || (window as any).__asyk?.state === 'LEVEL_COMPLETE', undefined, { timeout: 20_000 });
  const after = await page.evaluate(() => (window as any).__asyk.throwsLeft);
  expect(after).toBe(before - 1);
  expect(errors).toEqual([]);
});
