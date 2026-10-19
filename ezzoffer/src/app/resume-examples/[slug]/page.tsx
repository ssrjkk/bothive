import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { resumeExamples } from '@/lib/data';

export function generateStaticParams() {
  return resumeExamples.map((ex) => ({ slug: ex.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ex = resumeExamples.find((e) => e.slug === slug);
  if (!ex) return { title: 'Пример не найден' };
  return { title: ex.title, description: ex.preview };
}

export default async function ResumeExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ex = resumeExamples.find((e) => e.slug === slug);
  if (!ex) notFound();

  /*
   * Образец резюме.
   *
   * Сам шаблон показан как документ, а не как карточка: разделы идут
   * через линейку, строки — обычным текстом. Прежние точки-маркеры были
   * круглыми и стояли наравне с текстом, из-за чего достижения внутри
   * шаблона читались как декоративный список, а не как пункты опыта.
   */
  return (
    <div className="container-x py-12 md:py-16">
      <Link
        href="/resume-examples"
        className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
      >
        <span aria-hidden>←</span> Все примеры резюме
      </Link>

      <header className="mt-8 border-t-2 border-ink pt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            {ex.level}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {ex.role}
          </span>
        </div>
        <h1 className="display mt-4 max-w-4xl text-balance text-3xl md:text-5xl">{ex.title}</h1>
        <p className="measure mt-4 text-base leading-relaxed text-muted">{ex.preview}</p>
      </header>

      <div className="mt-12 grid gap-x-12 gap-y-12 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Шаблон резюме
          </p>
          <div className="mt-5">
            {ex.sections.map((s) => (
              <section
                key={s.h}
                className="border-t border-line py-6 first:border-t-2 first:border-ink"
              >
                <h2 className="font-serif text-lg leading-snug text-ink">{s.h}</h2>
                <ul className="mt-3">
                  {s.lines.map((l, i) => (
                    <li
                      key={i}
                      className="border-t border-line py-2.5 text-sm leading-relaxed text-ink"
                    >
                      {l}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <aside className="space-y-8">
          <div className="border-t-2 border-ink pt-5">
            <h2 className="font-serif text-lg leading-snug text-ink">Ключевые слова</h2>
            <p className="mt-4 flex flex-wrap gap-x-3 gap-y-2 font-mono text-sm text-ink">
              {ex.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
          </div>

          <div className="bg-ink px-6 py-7">
            <h2 className="font-serif text-lg leading-snug text-paper">Хотите так же?</h2>
            <p className="mt-2 text-sm leading-relaxed text-paper">
              Вставьте этот шаблон в кабинет EZOffer, и AI-улучшение доработает формулировки под
              ваши вакансии.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-sm bg-paper px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
            >
              Начать бесплатно
              <span aria-hidden>→</span>
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
