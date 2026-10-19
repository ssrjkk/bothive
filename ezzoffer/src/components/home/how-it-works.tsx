import { Section, SectionHead, PrimaryButton } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { steps } from '@/lib/data';

/*
 * «Как это работает».
 *
 * Прежняя версия — четыре одинаковые карточки в сетке 2×2, каждая с
 * размытым пятном, градиентной иконкой, огромным призрачным номером
 * и пилюлей-плашкой. Сетка карточек — самый шаблонный способ показать
 * последовательные шаги: он не даёт понять, что шаги идут во времени.
 *
 * Теперь это нумерованный перечень: номер моноширинным слева, вертикальная
 * черта разделяет шаги, порядок читается за счёт структуры, а не заливки.
 */

const icons: Record<string, React.ReactNode> = {
  link: (
    <path
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  sparkles: (
    <path
      d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Zm7 10l.9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13ZM6 15l.9 2.1L9 18l-2.1.9L6 21l-.9-2.1L3 18l2.1-.9L6 15Z"
      fill="currentColor"
    />
  ),
  send: (
    <path
      d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  bell: (
    <path
      d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
};

export function HowItWorks() {
  return (
    <Section id="how-it-work">
      <SectionHead
        eyebrow="Как это работает"
        title={
          <>
            Меньше усилий — <span className="text-accent">больше приглашений</span>
          </>
        }
        sub="Берём поиск работы на себя и экономим вам до 27 часов в неделю"
      />

      <ol className="border-t border-line">
        {steps.map((step, idx) => (
          // as="li" обязателен: <ol> допускает только <li> прямыми потомками,
          // а Reveal по умолчанию рендерит <div> — список перестаёт быть
          // списком для скринридера.
          <Reveal
            as="li"
            key={step.title}
            delay={idx * 70}
            className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-8"
          >
            <div className="flex items-baseline gap-4 md:col-span-1">
              <span className="font-mono text-sm tabular-nums text-accent">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <svg viewBox="0 0 24 24" className="size-5 text-muted md:hidden" aria-hidden>
                {icons[step.icon]}
              </svg>
            </div>

            <div className="md:col-span-4">
              <h3 className="font-serif text-xl leading-snug md:text-2xl">{step.title}</h3>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-accent">
                {step.badge}
              </p>
            </div>

            <div className="md:col-span-6">
              <p className="max-w-prose text-base leading-relaxed text-muted">{step.text}</p>
              {/* Иконка на широком экране живёт рядом с текстом: раньше она
                  занимала место карточки, которая сама по себе ничего
                  не сообщала. */}
              <svg
                viewBox="0 0 24 24"
                className="mt-4 hidden size-6 text-accent-2 md:block"
                aria-hidden
              >
                {icons[step.icon]}
              </svg>
            </div>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={120}>
        <div className="mt-12">
          <PrimaryButton href="/signup">Начать бесплатно</PrimaryButton>
        </div>
      </Reveal>
    </Section>
  );
}
