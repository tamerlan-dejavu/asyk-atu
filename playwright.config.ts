import { defineConfig } from '@playwright/test';

// BASE_URL задан — проверяем реальный деплой (post-deploy smoke), локальный сервер не поднимаем.
const external = process.env.BASE_URL;
const local = 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // 3D по умолчанию и навес гоняют программный WebGL: параллельные браузеры упираются в CPU и ловят тайм-ауты
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? local,
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // программный WebGL в headless-браузере (для 3D-вида); цифры FPS здесь не показательны
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    // обход защиты preview-деплоев Vercel (секрет «Protection Bypass for Automation»)
    extraHTTPHeaders: process.env.VERCEL_BYPASS
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
      : undefined,
  },
  webServer: external
    ? undefined
    : {
        command: process.env.PW_SKIP_BUILD
          ? 'npx vite preview --port 4173 --strictPort'
          : 'npm run build && npx vite preview --port 4173 --strictPort',
        url: local,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
