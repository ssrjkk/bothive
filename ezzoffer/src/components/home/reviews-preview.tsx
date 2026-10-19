import Link from 'next/link';
import { Section, SectionHead } from '@/components/ui';
import { HowItWorks } from '@/components/how-it-works';

/*
 * Было: превью отзывов на главной — те же выдуманные карточки, что и на
 * странице /reviews, плюс «Средняя оценка 4.9» в подзаголовке.
 *
 * Теперь блок показывает работу сервиса на конкретном примере. Отзывы не
 * выдумываются, потому что их неоткуда взять: сервис новый. Вместо этого
 * показано то, что проверить можно — письмо и разбор резюме, посчитанные
 * тем же кодом, что работает в проде.
 */
export function ReviewsPreview() {
  return (
    <Section>
      <SectionHead
        eyebrow="Как это работает"
        title={
          <>
            Не обещания, <span className="text-accent">а пример</span>
          </>
        }
        sub="Отзывов, которые можно показать, у нового сервиса честно мало. Показываем вместо них то, что проверяется: письмо и разбор резюме."
      />

      <HowItWorks />

      <div className="mt-10 flex flex-col items-start gap-4">
        <Link
          href="/reviews"
          className="inline-flex min-h-11 items-center gap-2 border-b border-ink py-1 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Разобрать подробнее
          <span aria-hidden>→</span>
        </Link>
        <Link
          href="/#tariff"
          className="-my-1 inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-accent"
        >
          Перейти к тарифам
        </Link>
      </div>
    </Section>
  );
}
