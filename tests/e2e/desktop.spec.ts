import { expect, test, type Page } from '@playwright/test';

/** Десктоп: раскладка, мышь, горячие клавиши, смена размера окна посреди раунда. Вид 2D — быстрее в CI. */
test.use({ viewport: { width: 1920, height: 1080 } });

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
      JSON.stringify({ v: 2, lang: 'ru', sound: false, quality: 'low', tutorialDone: true, unlocked: 1, seenHints: ['loft'] }),
    );
    sessionStorage.setItem('seeded', '1');
  });
}

const game = (page: Page) => page.evaluate(() => (window as any).__asyk as { state: string; throwsLeft: number });
const canvas = (page: Page) => page.locator('#game canvas:not(.three-canvas)');

async function toLevel1(page: Page, view = '2d'): Promise<void> {
  await page.goto(`/?view=${view}&fpsguard=0`);
  await page.locator('[data-act="play"]').click();
  await page.locator('[data-act="level"][data-arg="1"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING');
}

/** Натяжение мышью от сақа (нижняя часть поля) — без отпускания. */
async function pull(page: Page): Promise<void> {
  const b = (await canvas(page).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + b.height * 0.12, { steps: 8 });
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING');
  await page.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE', 'LEVEL_FAILED'].includes((window as any).__asyk?.state), undefined, {
    timeout: 60_000,
  });
}

test('1920×1080: две панели, поле ≥ 85 % высоты, без скролла, HUD над полем скрыт', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await toLevel1(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'desktop');
  await expect(page.locator('#side-l .spanel')).toBeVisible();
  await expect(page.locator('#side-r .spanel')).toBeVisible();
  await expect(page.locator('#hud .hud')).toBeHidden();
  const m = await page.evaluate(() => {
    const r = document.querySelector('#game canvas:not(.three-canvas)')!.getBoundingClientRect();
    const l = document.getElementById('side-l')!.getBoundingClientRect();
    const rr = document.getElementById('side-r')!.getBoundingClientRect();
    const de = document.documentElement;
    return {
      h: r.height / innerHeight,
      scroll: de.scrollWidth > innerWidth || de.scrollHeight > innerHeight,
      overlapL: l.right > r.left,
      overlapR: rr.left < r.right,
    };
  });
  expect(m.h).toBeGreaterThanOrEqual(0.85);
  expect(m.scroll).toBe(false);
  expect(m.overlapL).toBe(false);
  expect(m.overlapR).toBe(false);
  expect(errors).toEqual([]);
});

test('бросок мышью от сақа; Esc и правая кнопка отменяют натяжение; Esc без натяжения — пауза', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await toLevel1(page);
  const t0 = (await game(page)).throwsLeft;

  // Esc во время натяжения — отмена, не пауза
  await pull(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await game(page)).toMatchObject({ state: 'AIMING', throwsLeft: t0 });

  // правая кнопка во время натяжения — отмена
  await pull(page);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.up();
  expect(await game(page)).toMatchObject({ state: 'AIMING', throwsLeft: t0 });

  // обычный бросок
  await pull(page);
  await page.mouse.up();
  await settle(page);
  expect((await game(page)).throwsLeft).toBe(t0 - 1);

  // Esc без натяжения — пауза, ещё раз — продолжить
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await game(page)).state).toBe('PAUSED');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await game(page)).state).toBe('AIMING');
  expect(errors).toEqual([]);
});

test('клавиатура: стрелки + Space — бросок; M — звук; R — перезапуск с подтверждением', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await toLevel1(page);
  const t0 = (await game(page)).throwsLeft;

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await settle(page);
  expect((await game(page)).throwsLeft).toBe(t0 - 1);

  const sound = () => page.evaluate(() => JSON.parse(localStorage.getItem('asyk-atu:v1')!).sound as boolean);
  const s0 = await sound();
  await page.keyboard.press('KeyM');
  await expect.poll(sound).toBe(!s0);

  await page.keyboard.press('KeyR');
  await expect(page.locator('[data-act="restartYes"]')).toBeVisible();
  expect((await game(page)).state).toBe('PAUSED');
  await page.locator('[data-act="restartNo"]').click();
  await expect.poll(async () => (await game(page)).state).toBe('AIMING');
  expect((await game(page)).throwsLeft).toBe(t0 - 1);

  await page.keyboard.press('KeyR');
  await page.locator('[data-act="restartYes"]').click();
  await page.waitForFunction(() => (window as any).__asyk?.state === 'AIMING');
  expect((await game(page)).throwsLeft).toBe(t0);
  expect(errors).toEqual([]);
});

test('смена размера окна посреди раунда: раунд не сбрасывается, раскладка меняется без перезагрузки', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await toLevel1(page);
  await pull(page);
  await page.mouse.up();
  await settle(page);
  const before = await game(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'phone');
  await expect(page.locator('#hud .hud')).toBeVisible();
  await expect(page.locator('#side-l')).toBeHidden();
  expect(await game(page)).toMatchObject({ state: before.state, throwsLeft: before.throwsLeft });

  // натяжение, во время которого окно меняет размер: бросок не теряется
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'desktop');
  await page.waitForTimeout(300);
  await pull(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await settle(page);
  expect((await game(page)).throwsLeft).toBe(before.throwsLeft - 1);
  expect(errors).toEqual([]);
});

test('3D на десктопе: холст Three.js вписан в ту же рамку поля', async ({ page }) => {
  await seed(page);
  await toLevel1(page, '3d');
  await page.waitForFunction(() => !!document.querySelector('canvas.three-canvas'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const [a, b] = await page.evaluate(() =>
    ['#game canvas.three-canvas', '#game canvas:not(.three-canvas)'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round);
    }),
  );
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(1));
});
