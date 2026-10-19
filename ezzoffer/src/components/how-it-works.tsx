import { Reveal } from '@/components/reveal';
import { renderLetterTemplate } from '@/lib/cover-letter';
import { scoreVacancyForResume } from '@/lib/ai-matching';
import type { Vacancy } from '@/lib/vacancies/types';

/**
 * Как сервис работает — на конкретном примере.
 *
 * Раньше здесь стояли отзывы: восемь карточек с именами, ролями и результатами
 * («3 оффера 300k+», «42 звонка за 4 дня») и рейтинг 4.9. Сервис young,
 * настоящих пользователей единицы, и подтвердить эти цифры было нечем — но они
 * стояли наравне с замерами, и читались как замеры.
 *
 * Замена сделана принципиально другой: показываем не похвалу, а работу.
 * Текст письма и разбор «резюме против вакансии» ниже считаются теми же
 * функциями, что работают в проде, — `renderLetterTemplate` и
 * `scoreVacancyForResume`. Их можно проверить: пример сходится с тем, что
 * человек получит на самом деле.
 *
 * Демонстрация честнее отзыва: отзыв можно выдумать, а пример — нельзя.
 */

const RESUME_TITLE = 'Frontend-разработчик';

const RESUME = [
  'Frontend Developer',
  'Опыт: 6 лет коммерческой разработки.',
  'Сократил время загрузки приложения на 40%: LCP с 4.2с до 1.6с.',
  'Внедрил Storybook, онбординг новых разработчиков сократился с 5 дней до 2.',
  'Пишу на React, TypeScript и Next.js.',
].join('\n');

/*
 * Требования подобраны так, чтобы разбор показал обе стороны: и совпадения,
 * и пробелы. Если взять навыки, которых нет в словаре (Webpack, Jest —
 * извлекаются как пусто), скоринг их просто не увидит, и пример выйдет
 * «100 из 100, пробелов нет» — то есть подстроенным. Ровно этим он и
 * выглядел до правки: 100 баллов при заявленных требованиях, которые
 * никто не проверял.
 */
const VACANCY: Vacancy = {
  slug: 'hh-example',
  source: 'hh',
  source_id: 'example',
  title: 'Frontend-разработчик',
  company: 'Технологическая компания',
  salary: '250 000 — 320 000 ₽',
  salary_min: 250_000,
  salary_max: 320_000,
  level: 'Middle',
  format: 'Удалённо',
  city: 'Москва',
  posted: 'сегодня',
  published_at: null,
  category: 'Разработка',
  about: 'Ищем Frontend-разработчика. Требуются: React, TypeScript, Next.js, Docker, Redis.',
  responsibilities: [],
  requirements: ['React', 'TypeScript', 'Next.js', 'Docker', 'Redis'],
  bonus: [],
  source_url: null,
  contact_email: null,
  contact_phone: null,
};

const LETTER_TEMPLATE = [
  'Здравствуйте!',
  '',
  'Меня заинтересовала вакансия {вакансия} в компании {компания} ({город}).',
  'В последней работе: Сократил время загрузки приложения на 40%: LCP с 4.2с до 1.6с.',
  '',
  'Буду рад обсудить задачи и рассказать, как могу быть полезен.',
  '',
  'С уважением',
].join('\n');

export function HowItWorks() {
  const letter = renderLetterTemplate(LETTER_TEMPLATE, VACANCY);
  const scored = scoreVacancyForResume(VACANCY, RESUME, RESUME_TITLE);

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <Reveal className="lg:col-span-7">
        <figure className="border-t-2 border-ink pt-5">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-serif text-xl leading-snug text-ink">
              Сопроводительное письмо под эту вакансию
            </h3>
            <span className="font-mono text-xs text-muted">тот же код, что отправляет письмо</span>
          </figcaption>

          <pre className="measure mt-5 whitespace-pre-wrap border border-line bg-surface-2 p-5 font-sans text-sm leading-relaxed text-ink">
            {letter}
          </pre>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            Письмо строится по совпадению с резюме, а не из общего шаблона: строка с достижением и
            цифрой — та, которую работодатель спросит подробнее всего, поэтому она и попадает в
            письмо.
          </p>
        </figure>
      </Reveal>

      <Reveal delay={80} className="lg:col-span-5">
        <figure className="border-t-2 border-ink pt-5">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-serif text-xl leading-snug text-ink">Резюме против вакансии</h3>
            <span className="font-mono text-xs tabular-nums text-accent-2">
              {scored.score} из 100
            </span>
          </figcaption>

          <dl className="mt-5 space-y-3">
            {scored.factors.map((f) => (
              <div key={f.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm font-medium text-ink">{f.label}</dt>
                  <dd className="font-mono text-xs tabular-nums text-muted">
                    {f.earned} / {f.max}
                  </dd>
                </div>
                <p className="mt-0.5 text-sm leading-snug text-muted">{f.detail}</p>
              </div>
            ))}
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            {scored.matchedSkills.length > 0 ? (
              <p className="text-sm leading-relaxed text-ink">
                <span className="font-medium">Совпало:</span>{' '}
                <span className="text-muted">{scored.matchedSkills.join(', ')}</span>
              </p>
            ) : null}
            {scored.missingSkills.length > 0 ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                <span className="font-medium">Пробелы:</span>{' '}
                <span className="text-muted">{scored.missingSkills.join(', ')}</span>
              </p>
            ) : null}
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Пробелы — не минус. По ним собирается блок подготовки к собеседованию: о том, чего нет
              в резюме, всё равно спросят.
            </p>
          </div>
        </figure>
      </Reveal>
    </div>
  );
}
