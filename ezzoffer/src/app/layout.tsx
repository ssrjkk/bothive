import type { Metadata } from 'next';
import { Inter, Playfair_Display, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { envBaseUrl } from '@/lib/env';

/*
 * Шрифтовая система.
 *
 * Inter был шрифтом по умолчанию — и именно он делал сайт узнаваемо
 * «сгенерированным»: с Inter поверх ставится любой ИИ-конвейер. Заменяем на
 * связку, у которой есть характер и роли:
 *
 *   Playfair Display — журнальная антиква, заголовки;
 *   IBM Plex Sans    — текст и интерфейс;
 *   IBM Plex Mono    — цифры, статусы, метки.
 *
 * Подмножество cyrillic обязателен у всех трёх: сайт полностью русский, а
 * у многих красивых заголовков (Newsreader, Fraunces) кириллицы просто нет.
 */
const playfair = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-playfair',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-plex-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

// Inter оставлен только как запасной вариант: удалять его из импорта рискованно,
// пока в разметке остались прямые ссылки на --font-inter.
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const siteUrl = envBaseUrl(process.env, 'SITE_URL', 'https://ezoffer.ru');

export const metadata: Metadata = {
  // envBaseUrl, а не `process.env.SITE_URL ?? ...`: пустое значение из
  // .env.example доходило до new URL("") и роняло сборку на Invalid URL.
  metadataBase: new URL(siteUrl),
  title: {
    default: 'EZOffer — поиск работы без стресса и отказов',
    template: '%s | EZOffer',
  },
  description:
    'Подбор вакансий по резюме, автоотклик с сопроводительным письмом и уведомления в Telegram. 24 часа бесплатно без карты.',
  keywords: [
    'автоотклики',
    'поиск работы',
    'hh.ru',
    'резюме AI',
    'сопроводительные письма',
    'вакансии',
  ],
  openGraph: {
    title: 'EZOffer — поиск работы без стресса и отказов',
    description:
      'Подберём вакансии, улучшим резюме с AI и отправим отклики за вас. Пробный период 24 часа без карты.',
    locale: 'ru_RU',
    type: 'website',
    url: siteUrl,
    siteName: 'EZOffer',
  },
  twitter: {
    card: 'summary',
    title: 'EZOffer — поиск работы без стресса и отказов',
    description: 'Подберём вакансии, улучшим резюме с AI и отправим отклики за вас.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      data-scroll-behavior="smooth"
      className={`${playfair.variable} ${plexSans.variable} ${plexMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-ink">
        {/*
          Skip-link: клавиатурный пользователь иначе обязан пройти Tab'ом всю
          шапку и навигацию на каждой странице, чтобы добраться до контента.
          Ссылка скрыта визуально, но доступна с клавиатуры и появляется
          при фокусе — стандартный приём (WCAG 2.4.1 «Обход блоков»).
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Перейти к содержимому
        </a>
        <SiteHeader />
        {/* id нужен для якоря skip-link; tabIndex позволяет программно передать фокус. */}
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
