import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, SectionHead, Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { internships } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Стажировки для студентов и junior',
  description:
    'Платные стажировки по разработке, аналитике и маркетингу. Наставник, реальные задачи и путь в штат.',
};

/*
 * Страница стажировок.
 *
 * Прежний вид — сетка из трёх одинаковых карточек с заливкой, где
 * заголовок карточки стоит над описанием, а кнопка прибита к низу.
 * Читать такое можно только по одной карточке за раз, хотя стажировок
 * всего несколько и сравнивать их между собой — главный смысл страницы.
 *
 * Теперь это таблица: слева название и компания, справа формат и
 * оплата, между строками — волосяная линейка. Сравнение по строкам
 * получается само собой, без приёмов.
 */
export default function InternshipsPage() {
  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <Eyebrow>Инструменты</Eyebrow>
        <h1 className="display mt-4 max-w-4xl text-balance text-4xl md:text-6xl">
          Стажировки с <span className="text-accent">наставником</span> и задачами продукта
        </h1>
        <p className="measure mt-6 text-base leading-relaxed text-muted md:text-lg">
          Платные стажировочные треки для студентов и junior-специалистов: реальные задачи продукта,
          наставник и путь в штат.
        </p>
      </Section>

      <Section className="pt-0">
        <div className="border-t-2 border-ink">
          <div className="grid grid-cols-12 gap-x-6 border-b border-line pb-3">
            <p className="col-span-12 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-6">
              Трек
            </p>
            <p className="col-span-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-3 md:text-right">
              Формат
            </p>
            <p className="col-span-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-3 md:text-right">
              Оплата
            </p>
          </div>

          {internships.map((int, idx) => (
            <Reveal key={int.slug} delay={idx * 60} className="group border-b border-line py-7">
              <div className="grid grid-cols-12 gap-x-6 gap-y-4">
                <div className="col-span-12 md:col-span-6">
                  <h2 className="font-serif text-xl leading-snug text-ink transition-colors group-hover:text-accent md:text-2xl">
                    {int.title}
                  </h2>
                  <p className="mt-2 font-mono text-xs tracking-wide text-muted">
                    {int.company} · {int.city}
                  </p>
                  <p className="measure mt-3 text-sm leading-relaxed text-muted md:text-base">
                    {int.description}
                  </p>
                  {int.tags.length > 0 && (
                    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                      {int.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </p>
                  )}
                </div>

                <div className="col-span-6 md:col-span-3 md:text-right">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    {int.format}
                  </p>
                </div>

                <div className="col-span-6 flex flex-col items-start gap-4 md:col-span-3 md:items-end md:text-right">
                  <p className="font-mono text-lg tabular-nums text-ink">{int.salary}</p>
                  <Link
                    href="/signup"
                    className="inline-flex min-h-11 items-center gap-2 border-b border-ink py-1 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    Откликнуться
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-16">
          <SectionHead
            eyebrow="Как это устроено"
            title={
              <>
                Три шага — и <span className="text-accent">работа в портфолио</span>
              </>
            }
          />
          <ol className="grid gap-x-8 gap-y-10 md:grid-cols-3">
            {[
              ['Отбор', 'Отклик и короткое собеседование с ментором по вашей специальности.'],
              ['Работа', 'Реальные задачи продукта с код-ревью и еженедельной обратной связью.'],
              ['Рост', 'Лучшие стажёры получают оффер в штат и рекомендацию.'],
            ].map(([h, p], idx) => (
              <Reveal as="li" key={h} delay={idx * 80} className="border-t-2 border-ink pt-5">
                <p className="font-mono text-xs tabular-nums text-accent">
                  {String(idx + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-2 font-serif text-lg text-ink">{h}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </Section>
    </>
  );
}
