import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { computeSkillGaps } from '@/lib/skill-gaps';
import { learningPath, skillsWithPaths } from '@/lib/learning-paths';
import { Panel } from '@/components/dashboard/ui';
import { Section, SectionHead } from '@/components/ui';

export const metadata: Metadata = { title: 'Навыки' };
export const dynamic = 'force-dynamic';

/**
 * Пробелы в навыках и что с ними делать.
 *
 * Раздел «повышения квалификации» здесь не каталог курсов, а разбор собственных
 * данных: какие навыки требуют вакансии, на которые человек откликается или
 * собирается, и которых нет в резюме. Порядок задаётся отказами, а не
 * популярностью навыка — сначала то, что реально мешает.
 *
 * Что учить по навыку — содержание программы, а не ссылка на курс: ссылка
 * была бы проверяемым обещанием, которое перестаёт быть правдой через полгода.
 */
export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const report = computeSkillGaps(user.id);
  const withPaths = skillsWithPaths();

  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <SectionHead
          center={false}
          eyebrow="Квалификация"
          level="h1"
          title={
            <>
              Что закрыть <span className="text-accent">в первую очередь</span>
            </>
          }
          sub="Список собран по вашим откликам и по вакансиям в подборе. Не список популярного, а то, что мешает вам сейчас."
        />
        <GapsBody report={report} />
      </Section>

      <Section className="pt-0">
        <Panel>
          <h2 className="font-serif text-lg leading-snug text-ink">Учебные планы</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Содержание программы по навыкам, которые чаще всего требуют в вакансиях. Каждый пункт
            сформулирован так, чтобы было понятно, закрыт он или нет.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {withPaths.map((skill) => (
              <li key={skill}>
                <a
                  href={`#${slug(skill)}`}
                  className="block border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent-2/40"
                >
                  {skill}
                </a>
              </li>
            ))}
          </ul>
        </Panel>

        {withPaths.map((skill) => {
          const path = learningPath(skill);
          if (!path) return null;
          return (
            <article
              key={skill}
              id={slug(skill)}
              className="mt-6 scroll-mt-24 border-t-2 border-ink pt-5"
            >
              <h3 className="font-serif text-xl leading-snug text-ink">{path.skill}</h3>
              <p className="measure mt-2 leading-relaxed text-muted">{path.why}</p>
              <ol className="mt-4 space-y-3">
                {path.topics.map((topic, i) => (
                  <li key={topic.topic} className="flex gap-3">
                    <span className="mt-0.5 font-mono text-xs tabular-nums text-accent-2">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{topic.topic}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted">
                        Готово, когда: {topic.done}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-l-2 border-accent pl-3 text-sm leading-relaxed text-muted">
                {path.inJob}
              </p>
            </article>
          );
        })}
      </Section>
    </>
  );
}

type Report = ReturnType<typeof computeSkillGaps>;

function GapsBody({ report }: { report: Report }) {
  if (!report.basis.resumeFound) {
    return (
      <Panel className="mt-6">
        <p className="text-sm leading-relaxed text-muted">
          Нужно резюме — без него нельзя понять, чего в нём не хватает. Добавьте его в{' '}
          <a
            href="/dashboard/resumes"
            className="font-medium text-accent-2 underline-offset-2 hover:underline"
          >
            разделе «Резюме»
          </a>
          , и список соберётся сам.
        </p>
      </Panel>
    );
  }

  if (report.gaps.length === 0) {
    return (
      <Panel className="mt-6">
        <p className="text-sm leading-relaxed text-muted">
          Пробелов не видно: всё, что требуют вакансии из вашего подбора, уже есть в резюме.
          {report.basis.applications > 0
            ? ` Разобрано откликов: ${report.basis.applications}.`
            : ' Откликов пока нет — список уточнится, как только они появятся.'}
        </p>
      </Panel>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted">
        Откликов разобрано: {report.basis.applications}. Вакансий в подборе, где нужен навык,
        которого нет в резюме: {report.basis.targetedVacancies}.
      </p>

      {report.gaps.map((gap) => {
        const path = learningPath(gap.skill);
        return (
          <Panel key={gap.skill}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-serif text-lg leading-snug text-ink">{gap.skill}</h2>
              {path ? (
                <a
                  href={`#${slug(gap.skill)}`}
                  className="-my-1 inline-flex min-h-11 items-center text-sm font-medium text-accent-2 underline-offset-2 hover:underline"
                >
                  что учить →
                </a>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{gap.reason}</p>
          </Panel>
        );
      })}

      {report.covered.length > 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          Уже закрыто требованиями резюме: {report.covered.slice(0, 12).join(', ')}
          {report.covered.length > 12 ? ' и другие' : ''}.
        </p>
      ) : null}
    </div>
  );
}

function slug(skill: string): string {
  return `skill-${skill.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}
