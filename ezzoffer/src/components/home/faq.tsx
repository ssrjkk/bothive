import { Section, SectionHead } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { faq } from '@/lib/data';

/**
 * FAQ.
 *
 * Раньше это был клиентский компонент с `useState`: в серверную разметку
 * уезжал `grid-rows-[0fr] opacity-0` для всех вопросов, кроме первого. То
 * есть девять ответов из десяти были в HTML, но невидимы — и оставались
 * такими навсегда, если скрипты не загрузились: состояние `openIdx` никто
 * бы не изменил.
 *
 * Это не «не работает анимация», а отсутствующий контент на странице, у
 * которой весь текст — этот список. Встроенный браузер Telegram (а воронка
 * проекта начинается в Telegram), VK, почтовый клиент, режим «экономия
 * батареи» — все они получали пустую страницу.
 *
 * Теперь это нативные `<details>/<summary>`:
 *  - работает без JavaScript — ответ раскрывается по нажатию сам;
 *  - открыт по умолчанию только при наличии скриптов? Нет — наоборот: в
 *    серверной разметке закрыты все, и первый вопрос открыт атрибутом `open`,
 *    чтобы страница не выглядела пустой при мгновенном открытии;
 *  - `name` на группе даёт «аккордеон» в современных браузерах: открытый
 *    вопрос закрывает предыдущий, как и было задумано вручную;
 *  - состояние хранится в разметке, поэтому оно переживает перезагрузку и
 *    работает при копировании ссылки с открытым вопросом.
 */
export function FaqAccordion() {
  return (
    <Section className="relative">
      <SectionHead
        eyebrow="FAQ"
        title={
          <>
            Ответы на <span className="text-accent">частые вопросы</span>
          </>
        }
        sub="Мы уже ответили на всё, что обычно спрашивают перед стартом"
      />

      <div className="mx-auto max-w-3xl space-y-3">
        {faq.map((item, idx) => (
          <Reveal key={item.q} delay={idx * 40}>
            <details
              name="faq"
              /* Первый вопрос открыт: страница не должна выглядеть пустой
                 в первые кадры после открытия. */
              open={idx === 0}
              className="group border-b border-line open:border-accent"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-6 py-5 text-left [&::-webkit-details-marker]:hidden">
                {/* Вопрос антиквой и крупнее ответа: в FAQ читают вопросы,
                    ответы проглатывают. */}
                <span className="font-serif text-lg leading-snug md:text-xl">{item.q}</span>
                {/* Плюс превращается в крест — типографский приём. */}
                <span
                  aria-hidden
                  className="mt-1 shrink-0 font-mono text-xl leading-none transition-transform duration-200 group-open:rotate-45 group-open:text-accent"
                >
                  +
                </span>
              </summary>
              <p className="measure pb-6 text-sm leading-relaxed text-muted md:text-base">
                {item.a}
              </p>
            </details>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
