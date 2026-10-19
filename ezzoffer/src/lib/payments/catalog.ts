import type { CatalogItem } from './types';

/**
 * Каталог тарифов.
 *
 * Цена и срок хранятся здесь, а не в коде проверки: смена цены не должна
 * требовать релиза, а вебхук сверяет пришедшую сумму именно с этим списком.
 * Если бы сумма приходила из тела вебхука и оттуда же бралась «цена»,
 * подделанный платёж в 1 рубль выдавал бы Expert.
 *
 * `beta_life` — подписка без срока на время беты. Срок не хранится вовсе
 * (permanent), потому что любое значение в plan_expires_at для него — ошибка:
 * «истечёт через год» здесь означало бы, что вечность кончилась.
 */
export const CATALOG: CatalogItem[] = [
  {
    id: 'beta_life',
    title: 'Навсегда, пока в бете',
    priceRub: 0,
    days: 0,
    lifetime: true,
    permanent: true,
    methods: ['card', 'sbp', 'crypto_usdt'],
    features: [
      'Все лимиты тарифа «Эксперт» — 250 откликов в день',
      'Без ограничения срока на время бета-периода',
      'Прямой доступ к живым откликам на hh.ru',
    ],
  },
  {
    id: 'start',
    title: 'Старт',
    priceRub: 990,
    days: 30,
    lifetime: false,
    permanent: false,
    methods: ['card', 'sbp', 'crypto_usdt'],
    features: ['50 откликов в день', '5 резюме', 'Подбор вакансий'],
  },
  {
    id: 'pro',
    title: 'Про',
    priceRub: 2490,
    days: 30,
    lifetime: false,
    permanent: false,
    methods: ['card', 'sbp', 'crypto_usdt'],
    features: ['100 откликов в день', '20 резюме', 'Личные письма', 'Аналитика пробелов'],
  },
  {
    id: 'expert',
    title: 'Эксперт',
    priceRub: 4990,
    days: 30,
    lifetime: false,
    permanent: false,
    methods: ['card', 'sbp', 'crypto_usdt'],
    features: [
      '250 откликов в день',
      'Резюме без ограничения',
      'Telegram-бот',
      'Приоритетная поддержка',
    ],
  },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id === id);
}
