import Link from 'next/link';
import { Logo } from './site-header';

/*
 * Подвал.
 *
 * Было четыре колонки и двадцать ссылок, из которых восемь вели на те же
 * адреса: /faq стоял трижды («Вопросы и ответы», «База знаний», «Безопасность»),
 * /about — дважды («О нас», «Консультации»), /pricing, /blog, /jobs и /reviews
 * — по два раза. Это не разнообразие, а шум: человек выбирал между тремя
 * ссылками с одинаковым адресом и не мог понять, чем они различаются.
 *
 * Две ссылки обещали то, чего на странице больше нет: «Отзывы» и «Истории
 * успеха» вели на /reviews, где вместо отзывов теперь пример работы.
 *
 * И одна вела не туда: «Консультации» открывала /about. Сами консультации
 * существуют — есть api/consultations и страница в кабинете, — просто ссылка
 * была не на ту страницу.
 */
const columns = [
  {
    title: 'Инструменты',
    links: [
      { href: '/jobs', label: 'Вакансии' },
      { href: '/resume-examples', label: 'Примеры резюме' },
      { href: '/internships', label: 'Стажировки' },
      { href: '/pricing', label: 'Тарифы на автоотклики' },
    ],
  },
  {
    title: 'О сервисе',
    links: [
      { href: '/reviews', label: 'Как это работает' },
      { href: '/platform-rules', label: 'Правила платформ и безопасность' },
      { href: '/about', label: 'О сервисе' },
      { href: '/blog', label: 'Блог о поиске работы' },
    ],
  },
  {
    title: 'Помощь',
    links: [
      { href: '/faq', label: 'Вопросы и ответы' },
      { href: '/dashboard/consultations', label: 'Записаться на консультацию' },
      { href: '/signup', label: 'Начать бесплатно' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface-2">
      <div className="container-x py-14 md:py-16">
        {/* Три колонки, а не четыре: повторялась бы пустая полоса на широком
            экране, а колонок с неповторяющимися ссылками осталось три. */}
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Подбор вакансий, подходящее резюме и автоотклик с сопроводительным письмом. Пробный
              период 24 часа без привязки карты.
            </p>
            <p className="mt-5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted">
              <span className="inline-block size-1.5 rounded-full bg-success" aria-hidden />
              Сервис работает штатно
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              {/* Рубрика моноширинным, как в колонтитуле издания; раньше
                  здесь был sans-serif с трекингом — вид «стокового лендинга». */}
              <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
                {col.title}
              </p>
              {/*
                Ссылки в колонках: `inline-block py-1` вместо голой строки.

                Замер в Chromium на 360px: без этого высота цели нажатия была
                21px (text-sm 14px × line-height 1.5). Формально WCAG 2.5.8
                проходит за счёт расстояния между соседними пунктами, но палец
                в такую цель не попадает, а подвал есть на КАЖДОЙ странице
                сайта. `py-1` даёт 29px и не двигает соседей: список и так
                разнесён `space-y`.
              */}
              <ul className="space-y-1.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="inline-block py-1 text-sm text-muted transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 font-mono text-xs text-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} EZOffer. Все права защищены.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Link
              href="/faq"
              className="inline-flex min-h-11 items-center transition-colors hover:text-ink"
            >
              Условия сервиса
            </Link>
            <Link
              href="/faq"
              className="inline-flex min-h-11 items-center transition-colors hover:text-ink"
            >
              Политика конфиденциальности
            </Link>
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center transition-colors hover:text-ink"
            >
              Контакты
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
