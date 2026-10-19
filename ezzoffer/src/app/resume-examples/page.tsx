import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { resumeExamples } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Примеры резюме, которые проходят ATS',
  description:
    'Готовые примеры резюме по IT-ролям: Frontend, Backend, QA. Структура, ключевые слова и формулировки, которые нравятся рекрутерам и ATS-системам.',
};

/*
 * Индекс примеров резюме.
 *
 * Раньше это была сетка одинаковых карточек: каждая — серый блок с
 * цветной плашкой уровня. Плашки повторяли то, что уже написано в
 * заголовке («Frontend-разработчик, Middle» + «Middle»), а различались
 * карточки только длиной превью — то есть сравнивать образцы было нечем.
 *
 * Теперь это предметный указатель: уровень и роль моноширинным в одну
 * строку, название антиквой, превью — абзацем, теги — перечислением.
 * Разница между образцами читается, ничего не дублируясь.
 */
export default function ResumeExamplesPage() {
  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <Eyebrow>Инструменты</Eyebrow>
        <h1 className="display mt-4 max-w-4xl text-balance text-4xl md:text-6xl">
          Резюме, которое <span className="text-accent">проходит ATS</span>
        </h1>
        <p className="measure mt-6 text-base leading-relaxed text-muted md:text-lg">
          Готовые структуры резюме для популярных IT-ролей. Используйте их как образец: замените
          данные своими, сохранив формулировки с цифрами и правильные ключевые слова.
        </p>
      </Section>

      <Section className="pt-0">
        <div className="border-t-2 border-ink">
          <div className="grid grid-cols-12 gap-x-6 border-b border-line pb-3">
            <p className="col-span-12 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-6">
              Образец
            </p>
            <p className="col-span-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-3">
              Уровень
            </p>
            <p className="col-span-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-3 md:text-right">
              Роль
            </p>
          </div>

          {resumeExamples.map((ex, idx) => (
            <Reveal key={ex.slug} delay={idx * 60}>
              <Link
                href={`/resume-examples/${ex.slug}`}
                className="group grid grid-cols-12 gap-x-6 gap-y-3 border-b border-line py-7 transition-colors hover:bg-surface-2"
              >
                <div className="col-span-12 md:col-span-6">
                  <h2 className="font-serif text-xl leading-snug text-ink transition-colors group-hover:text-accent md:text-2xl">
                    {ex.title}
                  </h2>
                  <p className="measure mt-2 text-sm leading-relaxed text-muted md:text-base">
                    {ex.preview}
                  </p>
                  <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    {ex.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </p>
                </div>

                <p className="col-span-6 font-mono text-sm uppercase tracking-[0.12em] text-ink md:col-span-3">
                  {ex.level}
                </p>
                <p className="col-span-6 text-right font-mono text-sm text-muted md:col-span-3">
                  {ex.role}
                </p>
              </Link>
            </Reveal>
          ))}
        </div>

        <div className="mt-16 border-t-2 border-ink pt-10">
          <h2 className="font-serif text-2xl md:text-3xl">Готовое резюме под вашу вакансию</h2>
          <p className="measure mt-3 leading-relaxed text-muted">
            Загрузите своё резюме в кабинет — EZOffer адаптирует формулировки под целевые вакансии и
            посчитает ATS-скор.
          </p>
          <Link
            href="/signup"
            className="mt-7 inline-flex items-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Улучшить резюме
            <span aria-hidden>→</span>
          </Link>
        </div>
      </Section>
    </>
  );
}
