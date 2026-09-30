import { expect, test, type Page } from '@playwright/test';

/** Фоновая музыка: не звучит до жеста, стартует после клика, выключается в настройках, пауза при скрытии вкладки. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_vercel')) errors.push(m.text());
  });
  return errors;
}

const music = (page: Page) =>
  page.evaluate(
    () => (window as any).__music as { track: string | null; playing: boolean; paused: boolean; level: number; ctx: string | null },
  );

test('музыка: после первого клика играет, выключается в настройках, пауза при скрытой вкладке', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('asyk-atu:v1', JSON.stringify({ v: 2, lang: 'ru', sound: true, tutorialDone: true, unlocked: 1 }));
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/?fpsguard=0');
  await page.waitForFunction(() => (window as any).__asyk?.state === 'MENU');

  // до жеста — контекста нет, ничего не звучит
  expect(await music(page)).toMatchObject({ track: 'menu', playing: false, ctx: null });

  await page.locator('[data-act="goto"][data-arg="settings"]').click();
  await expect.poll(async () => (await music(page)).ctx, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => (await music(page)).playing, { timeout: 15_000 }).toBe(true);
  expect((await music(page)).level).toBeGreaterThan(0);

  // выключатель «Музыка»
  await page.locator('[data-act="musicSet"][data-arg="0"]').click();
  await expect.poll(async () => (await music(page)).level, { timeout: 5_000 }).toBeLessThan(0.01);
  await page.locator('[data-act="musicSet"][data-arg="1"]').click();
  await expect.poll(async () => (await music(page)).level, { timeout: 5_000 }).toBeGreaterThan(0.1);

  // вкладка скрыта → пауза, вернулись → продолжение
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await music(page)).toMatchObject({ paused: true, playing: false });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await music(page)).playing, { timeout: 10_000 }).toBe(true);
  expect(errors).toEqual([]);
});
