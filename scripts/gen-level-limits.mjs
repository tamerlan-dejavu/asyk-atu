// Генерирует supabase/migrations/0002_level_limits.sql из данных уровней (через загрузчик Vite, TS без сборки).
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const mod = await server.ssrLoadModule('/src/cloud/limits.ts');
  writeFileSync('supabase/migrations/0002_level_limits.sql', mod.limitsSql());
  console.log('written supabase/migrations/0002_level_limits.sql');
} finally {
  await server.close();
}
