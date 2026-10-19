import type { Metadata } from 'next';
import Link from 'next/link';
import { Section } from '@/components/ui';
import { HowItWorks } from '@/components/how-it-works';

export const metadata: Metadata = {
  title: 'Как это работает',
  description:
    'Пример работы EZOffer: сопроводительное письмо под конкретную вакансию и разбор резюме против требований — с теми же расчётами, что работают в сервисе.',
};

/*
 * Бывшая страница отзывов.
 *
 * На ней стояли восемь отзывов с именами, ролями и результатами («3 оффера
 * 300k+», «42 звонка за 4 дня»), рейтинг 4.9 и заголовок «Нам доверяют сотни
 * клиентов». Ни один из этих отзывов не был настоящим, подтвердить их было
 * нечем, а формулировки выглядели как замеры: «82% получают оффер за 3–4
 * недели» — это утверждение о результатах людей, которое сервис не измеряет.
 *
 * Страница не удалена, а заменена: вместо похвальных отзывов показан реальный
 * пример работы. Письмо и разбор считаются функциями, которые работают в
 * проде, поэтому пример совпадает с тем, что человек получит на самом деле.
 *
 * Итоговый адрес сохранён: ссылка на /reviews была в подвале, на главной и в
 * sitemap, и менять её без редиректа значит разорвать внешние закладки.
 */
export default function HowItWorksPage() {
  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
              <span aria-hidden className="block h-px w-7 bg-accent" />
              Как это работает
            </p>
            <h1 className="display mt-4 text-balance text-4xl md:text-6xl">
              Покажем работу, <span className="text-accent">а не обещания</span>
            </h1>
            <p className="measure mt-6 text-base leading-relaxed text-muted md:text-lg">
              Сервис новый, и отзывов, которые можно показать, пока честно мало. Поэтому вместо них
              — конкретный пример: вот письмо и разбор резюме для одной вакансии. Оба считает тот же
              код, что работает при реальном отклике.
            </p>
          </div>

          <div className="self-end lg:col-span-5">
            <p className="text-sm leading-relaxed text-muted">
              Это единственное, что здесь можно проверить: текст письма собран из совпадения с
              резюме, а баллы сложены из четырёх факторов с указанными весами — навыки, уровень,
              опыт, зарплата. Ни одна из этих цифр не «средняя по пользователям».
            </p>
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <HowItWorks />
      </Section>

      <Section className="pt-0">
        <div className="border-t-2 border-ink pt-8">
          <h2 className="font-serif text-2xl md:text-3xl">Попробовать на своих данных</h2>
          <p className="measure mt-3 leading-relaxed text-muted">
            Пример выше собран из тестовых данных. Проверьте на своём резюме — результат будет
            другим, и это полезно: вы увидите свои пробелы до того, как их увидит hr.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Попробовать бесплатно
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/dashboard/resumes"
              className="-my-1 inline-flex min-h-11 items-center text-sm font-medium text-accent-2 underline-offset-2 hover:underline"
            >
              Загрузить резюме →
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
