import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** Короткий SHA коммита: из CI/Vercel или из локального git. Показывается в «Настройки → О приложении». */
function buildSha(): string {
  const env = process.env.VITE_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: '/',
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/game/rules/**', 'src/game/levels/**', 'src/storage/**', 'src/challenge/**', 'src/shop/**', 'src/cloud/merge.ts'],
      thresholds: {
        'src/game/rules/**': { lines: 85 },
        'src/game/levels/**': { lines: 85 },
        'src/storage/**': { lines: 85 },
      },
    },
  },
});
