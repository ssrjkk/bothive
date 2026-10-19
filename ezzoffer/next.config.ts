import type { NextConfig } from 'next';

/*
 * Префикс путей для публикации на странице проекта GitHub Pages.
 *
 * Сайт проекта живёт по адресу /<имя-репозитория>, поэтому ассеты вида
 * /_next/static/... без префикса уедут на корень домена и вернут 404 — страница
 * откроется голой. Значение приходит из окружения: обычная сборка для VPS и
 * Docker префикса не получает и ведёт себя как раньше.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // Автономная сборка для простого деплоя (VPS/Docker): .next/standalone
  output: 'standalone',
  // Не отдавать наружу версию фреймворка: заголовок X-Powered-By упрощает
  // подбор известных эксплойтов и не даёт посетителю никакой пользы.
  // Через headers() это не убирается — Next добавляет его сам, поэтому
  // отключаем флагом ниже, а пустой заголовок в headers() оставлен как
  // дополнительный барьер для прокси, которые дописывают его сами.
  poweredByHeader: false,
  // Шрифт с кириллицей для PDF-экспорта резюме НЕ добавляется через
  // outputFileTracingIncludes: Turbopack при таком включении разворачивает в
  // трассировку весь проект (исходники, тесты) — standalone раздувался с 36 до
  // 47 МБ. Вместо этого файл копируется в образ явно в Dockerfile и правится
  // вручную при ручном деплое (см. README, раздел «Деплой»).
  // Путь к SQLite вычисляется в рантайме, поэтому file tracing считает его
  // динамическим и тянет в образ локальную ./data — вместе с ezoffer.db
  // (хэши паролей, OAuth-токены) и бэкапами. Каталог создаётся при старте,
  // поэтому в образе ему не место: данные приходят из volume.
  outputFileTracingExcludes: {
    '/*': ['data/**/*'],
    instrumentation: ['data/**/*'],
    middleware: ['data/**/*'],
  },
  async headers() {
    // Заголовки безопасности. Раньше отсутствовали CSP и HSTS — при этом
    // набор остальных (X-Frame-Options, nosniff, Referrer-Policy) уже был.
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      // HSTS: браузер запоминает, что на этот домен нужно ходить только по HTTPS.
      // Включается всегда — для локальной разработки по http://localhost это
      // безвредно (браузеры не применяют HSTS к localhost).
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      // Запрет обращений к API из чужих источников (нужен для fetch с credentials).
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      // Не отдавать версию движка наружу: облегчает подбор эксплойтов.
      { key: 'X-Powered-By', value: '' },
    ];

    /**
     * Content-Security-Policy.
     *
     * `'unsafe-inline'` в script-src нужен Next.js: он встраивает inline-скрипты
     * (гидрация, JSON-LD, bootstrap-данные). Он также нужен из-за framer-motion,
     * который инлайнит стили. Полностью строгий CSP без nonce сломает рендеринг,
     * поэтому здесь фиксируется верхняя граница: скрипты только self, внешние
     * ресурсы только с https, и запрет object/frame.
     *
     * connect-src включает API hh.ru и Telegram — без них перестаёт работать
     * связка аккаунта и отправка уведомлений.
     */
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.hh.ru https://api.telegram.org",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, { key: 'Content-Security-Policy', value: csp }],
      },
      // API-ответы не должны кэшироваться прокси: они содержат персональные
      // данные пользователя (профиль, статистика, резюме).
      {
        source: '/api/:path*',
        headers: [...securityHeaders, { key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default nextConfig;
