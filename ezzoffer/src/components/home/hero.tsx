import Link from 'next/link';
import { PrimaryButton, GhostButton, Eyebrow } from '@/components/ui';
import { jobs, stats } from '@/lib/data';

/*
 * Первый экран.
 *
 * Прежняя версия: три размытых цветных пятна, сетка на фоне, всё по центру,
 * градиентный текст в заголовке, радужные аватары и бегущая строка вакансий.
 * Это конструктор «как выглядит хороший SaaS-лендинг», собранный из
 * готовых блоков, и именно он давал ощущение шаблона.
 *
 * Теперь — полоса газетной вёрстки: асимметрия (заголовок слева, сводка
 * справа), линейки как единственный разделитель, антиква в заголовке,
 * моноширинный в числах. Ничего не мигает и не двигается: движение на
 * первом экране маскирует отсутствие содержания.
 */

const listed = jobs.slice(0, 7);

function Listings() {
  return (
    <div className="border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          В работе
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {jobs.length} в каталоге
        </span>
      </div>
      <ul>
        {listed.map((job, idx) => (
          <li key={job.slug} className={`px-5 py-3.5 ${idx > 0 ? 'border-t border-line' : ''}`}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="truncate text-sm font-medium text-ink">{job.title}</p>
              <p className="shrink-0 font-mono text-xs tabular-nums text-muted">{job.salary}</p>
            </div>
            <p className="mt-1 truncate text-xs text-muted">
              {job.company} · {job.city} · {job.format} · {job.level}
            </p>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-5 py-3">
        <Link
          href="/jobs"
          className="-my-1 inline-flex min-h-11 items-center text-xs font-semibold text-accent underline-offset-4 hover:underline"
        >
          Весь каталог →
        </Link>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="border-b border-line pt-14 pb-16 md:pt-20 md:pb-24">
      <div className="container-x">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <Eyebrow>Автоотклик с сопроводительным письмом</Eyebrow>

            <h1 className="display mt-7 text-[2.75rem] text-balance sm:text-6xl md:text-7xl">
              Поиск работы
              <br />
              <span className="text-accent">без стресса</span> и отказов
            </h1>

            <p className="measure mt-8 text-lg leading-relaxed text-muted">
              Улучшим резюме, подберём релевантные вакансии и отправим до 100 персональных откликов
              в день. Вам останется выбирать лучшие приглашения — а не вести переписку с сотней
              вакансий.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <PrimaryButton href="/signup">Попробовать бесплатно</PrimaryButton>
              <GhostButton href="/#how-it-work">Как это работает</GhostButton>
            </div>

            <p className="mt-6 font-mono text-xs text-muted">
              24 часа бесплатно · без привязки карты · отмена в один клик
            </p>
          </div>

          <div className="lg:col-span-5">
            <Listings />
          </div>
        </div>

        <dl className="mt-20 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-line pt-10 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="font-mono text-3xl tabular-nums text-ink md:text-4xl">{stat.value}</dt>
              <dd className="mt-2 text-sm leading-snug text-muted">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
