/**
 * Восстановление резервной копии из локального хранилища в ТЕКУЩУЮ БД окружения.
 *   pnpm exec tsx scripts/restore.ts 2026-10-21 --confirm
 * Существующие строки не перезаписываются (INSERT … ON CONFLICT DO NOTHING) — восстанавливать
 * следует в пустую БД. Перед этим остановите приём (TELEGRAM_MODE=off), чтобы не смешать данные.
 */
import { createPlatform } from '~server/platform';
import { applySchema } from '~server/migrations';
import { buildContainer } from '~server/container';

const [date, flag] = process.argv.slice(2);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Использование: pnpm exec tsx scripts/restore.ts YYYY-MM-DD --confirm');
  process.exit(1);
}
const platform = createPlatform();
const c = buildContainer(platform);
const available = await c.maintenance.listBackups();
console.log('Доступные копии:', available.join(', ') || '—');
if (flag !== '--confirm') {
  console.log(`Проверка пройдена. Для восстановления backups/${date}/ добавьте --confirm`);
  process.exit(0);
}
await applySchema(platform);
await c.maintenance.restore(date, (s) => console.log(s));
console.log('Готово');
process.exit(0);
