import type { MetadataRoute } from 'next';

/**
 * Цвета PWA берутся из темы `globals.css`.
 *
 * Раньше здесь стояли `#06060b` и `#7c5cff` — цвета прошлой, тёмно-фиолетовой
 * темы, которой в проекте уже нет (текущая: бумага #f7f5f0, чернила #15130f,
 * акцент #9a2a22). При `display: "standalone"` Android 12+ рисует splash по
 * `background_color`, а системную строку — по `theme_color`, то есть
 * кремовый сайт на телефоне открывался чёрным экраном с фиолетовой полосой.
 * Причём это заметнее всего на медленной сети — то есть ровно там, где
 * человек уходит, если выглядит сломанным.
 *
 * Заодно добавлена маскable-иконка: Android обрезает иконку по своей маске,
 * и без `purpose: "maskable"` обычная иконка показывается с полями.
 */
const PAPER = '#f7f5f0';
const INK = '#15130f';
const ACCENT = '#9a2a22';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EZOffer — поиск работы без стресса и отказов',
    short_name: 'EZOffer',
    description:
      'Подбор вакансий по резюме, автоотклик с сопроводительным письмом и уведомления в Telegram.',
    start_url: '/',
    display: 'standalone',
    background_color: PAPER,
    theme_color: PAPER,
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}

export { INK, ACCENT };
