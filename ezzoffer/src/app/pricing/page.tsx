import type { Metadata } from 'next';
import { Section, SectionHead } from '@/components/ui';
import { PricingSection } from '@/components/home/pricing';

export const metadata: Metadata = {
  title: 'Тарифы',
  description:
    'Тарифы EZOffer: Старт, Про и Эксперт. Пробный период 24 часа без карты, отмена в один клик.',
};

export default function PricingPage() {
  return (
    <>
      <Section className="pb-0 pt-16 md:pt-24">
        <SectionHead
          eyebrow="Тарифы"
          level="h1"
          title={
            <>
              Подходящий тариф <span className="text-accent">найдётся для каждого</span>
            </>
          }
          sub="Попробуйте весь функционал бесплатно и выберите наиболее подходящий период"
        />
      </Section>
      <PricingSection compact />
    </>
  );
}
