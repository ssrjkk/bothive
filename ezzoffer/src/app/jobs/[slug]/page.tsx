import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { jobs } from '@/lib/data';
import { LevelPill } from '@/components/home/jobs-preview';
import { JsonLd } from '@/components/json-ld';

const siteUrl = process.env.SITE_URL ?? 'https://ezoffer.ru';

// SSG: дата фиксируется на момент сборки — корректно для статических страниц.
const nowIso = new Date().toISOString();
const validIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function salaryRange(text: string) {
  const match = text.match(/от\s*([\d\s]+)/);
  return match ? parseInt(match[1].replace(/\s/g, ''), 10) : null;
}

/**
 * Список требований.
 *
 * Было: круглый маркер-точка наравне с текстом, из-за чего блок читался
 * как декоративное облако буллитов. Стало: разделение по волосяной
 * линейке — как список условий в вакансии, где важно видеть каждый
 * пункт целиком, а не то, что он «начат».
 */
function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-4">
      {items.map((item) => (
        <li
          key={item}
          className="border-t border-line py-3 text-sm leading-relaxed text-ink md:text-base"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t-2 border-ink pt-5">
      <h2 className="font-serif text-xl leading-snug text-ink md:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export function generateStaticParams() {
  return jobs.map((job) => ({ slug: job.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = jobs.find((j) => j.slug === slug);
  if (!job) return { title: 'Вакансия не найдена' };
  return {
    title: job.title,
    description: `${job.title} — ${job.company}, ${job.salary}, ${job.format}. Откликнемся за вас в EZOffer.`,
  };
}

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = jobs.find((j) => j.slug === slug);
  if (!job) notFound();

  const related = jobs
    .filter((j) => j.category === job.category && j.slug !== job.slug)
    .slice(0, 3);
  const minSalary = salaryRange(job.salary);

  return (
    <div className="container-x py-12 md:py-16">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          title: job.title,
          url: `${siteUrl}/jobs/${job.slug}`,
          description: `${job.about}\n\n${job.responsibilities.join('\n')}`,
          datePosted: nowIso,
          validThrough: validIso,
          employmentType: 'FULL_TIME',
          hiringOrganization: { '@type': 'Organization', name: job.company },
          jobLocation: {
            '@type': 'Place',
            address: { '@type': 'PostalAddress', addressLocality: job.city, addressCountry: 'RU' },
          },
          ...(minSalary
            ? {
                baseSalary: {
                  '@type': 'MonetaryAmount',
                  currency: 'RUB',
                  value: { '@type': 'QuantitativeValue', minValue: minSalary, unitText: 'MONTH' },
                },
              }
            : {}),
        }}
      />

      <Link
        href="/jobs"
        className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
      >
        <span aria-hidden>←</span> Все вакансии
      </Link>

      {/*
        Шапка вакансии.

        Квадрат с градиентом и первыми двумя буквами компании был
        «логотипом-заглушкой» — он не обозначал компанию, а только
        занимал место. Данные о компании и так есть строкой ниже, поэтому
        лишний знак убран: заголовок начинается сразу с названия позиции.
      */}
      <header className="mt-8 border-t-2 border-ink pt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LevelPill level={job.level} />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {job.category}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {job.posted}
          </span>
        </div>

        <h1 className="display mt-4 max-w-4xl text-balance text-3xl md:text-5xl">{job.title}</h1>

        <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <p className="font-mono text-xl tabular-nums text-ink md:text-2xl">{job.salary}</p>
          <p className="text-sm text-muted md:text-base">
            {job.company} · {job.city} · {job.format}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Откликнуться через EZOffer
            <span aria-hidden>→</span>
          </Link>
          <p className="text-sm leading-relaxed text-muted">
            Автоотклик займёт 0 секунд вашего времени
          </p>
        </div>
      </header>

      <div className="mt-12 grid gap-x-12 gap-y-12 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-12">
          <Block title="О компании и позиции">
            <p className="measure mt-4 text-sm leading-relaxed text-muted md:text-base">
              {job.about}
            </p>
          </Block>

          <Block title="Чем предстоит заниматься">
            <List items={job.responsibilities} />
          </Block>

          <Block title="Что мы ждём">
            <List items={job.requirements} />
          </Block>

          <Block title="Будет плюсом">
            <List items={job.bonus} />
          </Block>
        </div>

        <aside className="space-y-8">
          <div className="bg-ink px-6 py-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">
              А вы знали?
            </p>
            <h2 className="mt-3 font-serif text-xl leading-snug text-paper">
              На эту вакансию уже откликнулись другие
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-paper">
              Отклики в первые часы после публикации получают в 3–5 раз больше просмотров. EZOffer
              отправляет отклик в первые минуты появления вакансии.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-sm bg-paper px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
            >
              Откликнуться первым
              <span aria-hidden>→</span>
            </Link>
          </div>

          {related.length > 0 ? (
            <div className="border-t-2 border-ink pt-5">
              <h2 className="font-serif text-lg leading-snug text-ink">Похожие вакансии</h2>
              <div className="mt-3">
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/jobs/${r.slug}`}
                    className="group block border-b border-line py-3 transition-colors"
                  >
                    <p className="text-sm font-medium text-ink transition-colors group-hover:text-accent">
                      {r.title}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {r.salary} · {r.format}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
