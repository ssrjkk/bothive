import Link from 'next/link';

/**
 * 404.
 *
 * Прежняя версия центрировала всё и набирала «404» девяностоточечным
 * градиентом. На бумаге градиент даёт заливку, а центр — самую
 * предсказуемую композицию из возможных.
 *
 * Теперь это полоса в стиле газетной колонки: номер ошибки моноширинным
 * как колонцифра, заголовок антиквой, текст слева, действия справа.
 */

export default function NotFound() {
  return (
    <div className="container-x py-20 md:py-28">
      <div className="grid gap-10 border-t-2 border-ink pt-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="font-mono text-6xl tabular-nums text-accent md:text-8xl">404</p>
          <h1 className="display mt-5 text-3xl md:text-4xl">Куда-то не туда</h1>
          <p className="measure mt-4 leading-relaxed text-muted">
            Такой страницы нет. Зато можно вернуться на главную и начать поиск оффера мечты.
          </p>
        </div>

        <div className="flex flex-col items-start gap-4 lg:col-span-4 lg:col-start-9 lg:items-end lg:justify-end">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            На главную
          </Link>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 border-b border-ink pb-0.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Смотреть вакансии
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
