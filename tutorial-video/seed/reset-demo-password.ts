// Разовый сброс пароля demo.manager на известное значение, чтобы capture.mjs мог войти.
// AICODE-NOTE: пароль, выданный при первом создании demo.manager, не сохранялся — восстанавливаем
// через официальный AdminService.changePassword (тот же хэш, что при входе), а не прямым SQL.
import { createPlatform } from '~server/platform';
import { buildContainer } from '~server/container';

if (process.env.ALLOW_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production') throw new Error('Demo seeding requires ALLOW_DEMO_SEED=true outside production');
const platform = createPlatform();
const c = buildContainer(platform);
const PASSWORD = process.env.DEMO_MANAGER_PASSWORD ?? '';
if (PASSWORD.length < 10) throw new Error('Задайте DEMO_MANAGER_PASSWORD (не короче 10 символов)');

const row = await platform.db.first<{ id: number }>('SELECT id FROM admins WHERE login = ?', ['demo.manager']);
if (!row) throw new Error('demo.manager не найден — сначала запустите demo-seed.ts');
await c.admins.changePassword(row.id, PASSWORD, 'demo-reset');
console.log('Пароль demo.manager обновлён, id', row.id);
process.exit(0);
