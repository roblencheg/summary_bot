> Только для изолированной тестовой БД. Перед seed задайте ALLOW_DEMO_SEED=true. Не запускайте на сервере с рабочими данными.

# Обучающий ролик «Инструкция руководителя»

Ролик ~4 мин, 1920×1080, 30 fps: настоящий интерфейс на демо-данных + сцены Telegram + озвучка и субтитры.
Сценарий — `docs/manager-guide.md`, текст озвучки — `src/narration.json`, раскадровка — `src/storyboard.ts`.

## Пересобрать

Все шаги — в dev-окружении (dev-БД, dev-сервер на :3000). В prod ничего не пишется.

```sh
# 1. демо-данные: дирекция «Демонстрационное подразделение», руководитель demo.manager, чаты Telegram и MAX,
#    инциденты, саммари + экспорт HTML саммари/алерта/меню в public/tg.json
DEMO_MANAGER_PASSWORD=<≥10 символов> pnpm exec tsx tutorial-video/seed/demo-seed.ts
# demo.manager создаётся один раз; если пароль утерян — сбросить:
#   DEMO_MANAGER_PASSWORD=<новый> pnpm exec tsx tutorial-video/seed/reset-demo-password.ts

cd tutorial-video && pnpm install
# 2. снимки интерфейса и координаты элементов → public/shots/
DEMO_MANAGER_PASSWORD=<тот же> node capture/capture.mjs
# 3. озвучка (ElevenLabs API, голос Will) + тайминг предложений и слов → public/audio/
node voice/voice.mjs
# 4. просмотр и рендер
npx remotion studio
npx remotion render src/index.ts Tutorial out/video.mp4 --codec=h264 --pixel-format=yuv420p --crf=20 --concurrency=2
```

Без локального Chrome передайте `--browser-executable` (headless shell Playwright из `/opt/ms-playwright`).

## Как устроено

- `src/data.ts` — сегменты по длительности озвучки; метки времени `"s1"` (предложение), `"w:слово"` (начало слова), `"end-1"`.
- `src/scenes/UiScene.tsx` — окно браузера со снимком, камера наезжает на цель, курсор и клики по координатам из `shots.json`.
- `src/scenes/TgScene.tsx` — чат с ботом: настоящие rich-саммари, алерт и меню из `tg.json`.
- Текст озвучки поменяли → `node voice/voice.mjs` перегенерирует только изменённые сегменты, раскадровка подстроится по словам.
