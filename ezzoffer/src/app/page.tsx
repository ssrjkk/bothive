import type { Metadata } from 'next';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';
import { Security } from '@/components/home/security';
import { Limits } from '@/components/home/limits';
import { Advantages } from '@/components/home/advantages';
import { ResumeSlider } from '@/components/home/resume-slider';
import { TelegramBot } from '@/components/home/telegram-bot';
import { PricingSection } from '@/components/home/pricing';
import { ReviewsPreview } from '@/components/home/reviews-preview';
import { FaqAccordion } from '@/components/home/faq';
import { Team } from '@/components/home/team';
import { JobsPreview } from '@/components/home/jobs-preview';
import { BlogPreview } from '@/components/home/blog-preview';
import { CtaBanner } from '@/components/home/cta';
import { JsonLd } from '@/components/json-ld';
import { envBaseUrl } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Поиск работы без стресса и отказов',
  description:
    'Подбор вакансий по резюме, автоотклик с сопроводительным письмом и уведомления о приглашениях и отказах.',
};

const siteUrl = envBaseUrl(process.env, 'SITE_URL', 'https://ezoffer.ru');

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'EZOffer',
          url: siteUrl,
          description:
            'Сервис автооткликов: подбирает вакансии по резюме, отправляет отклик с письмом и присылает статусы.',
          logo: `${siteUrl}/icon.svg`,
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'EZOffer',
          url: siteUrl,
        }}
      />
      {/*
        Порядок блоков — это порядок аргументов, а не случайная раскладка.

        Прежний порядок был произвольным: истории об успехе шли пятыми,
        вакансии — тринадцатыми, после «команды». То есть ядро продукта
        (то, ради чего человек пришёл) оказывалось в самом низу страницы,
        а социальное доказательство — в начале.

        Теперь это пять актов:

          1. Обещание     — первый экран и «как это работает»
          2. Доказательство — истории людей, уже получивших оффер
          3. Продукт      — всё, что сервис реально делает: резюме,
                            подбор, отклики, Telegram
          4. Честность    — риски и блокировки. Сознательно ПОСЛЕ пользы:
                            человек, увидевший отказы первыми, уходит до
                            того, как поймёт, что сервис что-то делает
          5. Решение      — тариф, отзывы, вопросы, команда, статьи, призыв

        Четвёртый акт — единственное место, где порядок спорный. Риск можно
        подать и раньше, но тогда он читается как «почему не пользоваться»,
        а после конкретного списка возможностей — как «что нужно знать, чтобы
        решиться».
      */}
      <Hero />
      <HowItWorks />

      <Limits />

      <Advantages />
      <ResumeSlider />
      <JobsPreview />
      <TelegramBot />

      <Security />

      <PricingSection />
      <ReviewsPreview />
      <FaqAccordion />
      <Team />
      <BlogPreview />
      <CtaBanner />
    </>
  );
}
