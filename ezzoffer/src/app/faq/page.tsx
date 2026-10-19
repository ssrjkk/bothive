import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, SectionHead } from '@/components/ui';
import { FaqAccordion } from '@/components/home/faq';

export const metadata: Metadata = {
  title: 'Вопросы и ответы',
  description:
    'FAQ EZOffer: безопасность, автоотклики, резюме, сопроводительные письма, тарифы и пробный период.',
};

export default function FaqPage() {
  return (
    <>
      <Section className="pb-0 pt-16 md:pt-24">
        <SectionHead
          eyebrow="FAQ"
          level="h1"
          title={
            <>
              Вопросы и <span className="text-accent">ответы</span>
            </>
          }
          sub="Не нашли ответ — напишите в поддержку, отвечаем в течение часа в рабочее время"
        />
      </Section>
      <FaqAccordion />

      <Section className="border-t border-line">
        {/* Врезка-вопрос: инверсная полоса вместо градиентного блока с
            центрированием. Тот же приём, что на статьях блога и странице
            вакансии — одна форма на весь сайт. */}
        <div className="bg-ink px-7 py-10 md:px-12 md:py-14">
          <div className="grid gap-8 md:grid-cols-12 md:items-end md:gap-12">
            <div className="md:col-span-7">
              <h2 className="font-serif text-2xl leading-snug text-paper md:text-3xl">
                Остались вопросы?
              </h2>
              <p className="measure mt-4 leading-relaxed text-paper">
                Начните с бесплатного периода — половина вопросов исчезает после первого дня работы
                сервиса. Остальное расскажет поддержка.
              </p>
            </div>
            <div className="md:col-span-5 md:text-right">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-sm bg-paper px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
              >
                Попробовать бесплатно
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
