# BotHive

> **Языки:** [English](README.md) · [Русский](README.ru.md)

Самодостаточный сервис оркестрации ботов для Telegram, Twitch, YouTube, Twitter,
Discord, Slack, Bluesky и криптовалютной торговли. Общие API, очередь BullMQ,
панель управления и изолированный движок сценариев.

**Сайт:** https://ssrjkk.github.io/bothive/  
**Исходники:** https://github.com/ssrjkk/bothive

## Возможности

- Отдельный worker для каждой платформы и независимое масштабирование.
- Управление аккаунтами, ботами, сценариями и вебхуками из одной панели.
- Песочница сценариев с триггерами событий и интервалами.
- RBAC, шифрование токенов AES-256-GCM и rate limiting.
- Пул прокси, резервное копирование и восстановление.
- Prometheus, Grafana, структурированные логи и live-логи через WebSocket.
- Криптовалютный worker включается отдельно и по умолчанию выключен.

## Запуск в Docker

```bash
cp .env.example .env
docker compose up -d --build
npx prisma db seed
```

Заполните `ENCRYPTION_KEY`, `PASSWORD_PEPPER` и `JWT_SECRET`. После seed смените
демо-пароль администратора.

- Панель: http://localhost:80
- API: http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

## Локальная разработка

```bash
npm install
docker compose up -d postgres redis
npm run dev
```

## Проверки

```bash
npm run check
npm test
npm run coverage
```

## Документация

- [API](docs/api.md)
- [Движок сценариев](docs/scripts.md)
- [Вебхуки](docs/webhooks.md)
- [Деплой](docs/deployment.md)
- [Модель безопасности](docs/security.md)
- [Runbooks](docs/runbooks/README.md)
- [Безопасность](SECURITY.md)

## Лицензия

MIT — см. [LICENSE](LICENSE).
