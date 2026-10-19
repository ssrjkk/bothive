import Link from 'next/link';
import { Section, SectionHead } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { advantages } from '@/lib/data';

const icons: Record<string, React.ReactNode> = {
  activity: (
    <path
      d="M3 12h4l3 8 4-16 3 8h4"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  filter: (
    <path
      d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  chart: (
    <path
      d="M3 21h18M7 17v-6M12 17V7M17 17v-4M3 3v18"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  telegram: (
    <path
      d="m22 3-3.5 17-7.5-4.5L6 20l1-6L3 11l19-8Zm-6 5L9 14.5M22 3 11 13"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      stroke="currentColor"
      fill="none"
    />
  ),
  compass: (
    <path
      d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3 6-1.5 4.5L9 15l1.5-4.5L15 9Z"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
  files: (
    <path
      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      stroke="currentColor"
      fill="none"
    />
  ),
};

export function Advantages() {
  return (
    <Section>
      <SectionHead
        eyebrow="Преимущества сервиса"
        title={
          <>
            Всё для <span className="text-accent">результата</span>
          </>
        }
        sub="Находим лучшие вакансии, анализируем отклики и делаем поиск работы результативным"
      />

      <div className="grid border-t border-line sm:grid-cols-2 sm:divide-x sm:divide-line lg:grid-cols-3">
        {advantages.map((item, idx) => (
          <Reveal
            key={item.title}
            delay={idx * 60}
            className={item.wide ? 'sm:col-span-2 lg:col-span-1' : ''}
          >
            {/*
              Раньше: карточка с градиентной иконкой, размытым пятном при
              наведении и подъёмом на пиксель. Ни то, ни другое ничего не
              сообщало: пятно исчезало при отведении мыши, а подъём намекал,
              что карточка кликабельна, хотя кликабельна она не была.
              Теперь — линейки и заголовок антиквой.
            */}
            <div className="h-full border-b border-line py-8 sm:px-8 sm:py-10 sm:first:pl-0">
              <svg viewBox="0 0 24 24" className="size-6 text-accent-2" aria-hidden>
                {icons[item.icon]}
              </svg>
              <h3 className="mt-5 font-serif text-xl leading-snug">{item.title}</h3>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted md:text-base">
                {item.text}
              </p>
            </div>
          </Reveal>
        ))}

        <Reveal delay={200} className="sm:col-span-2 lg:col-span-1">
          {/*
            Единственная инверсная панель на главной: чёрная полоса с
            обратной ссылкой. Приём осознанный — он отделяет призыв от
            перечисления преимуществ, а не добавляет ещё одно преимущество.
          */}
          <div className="flex h-full flex-col justify-between gap-6 bg-ink p-8">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper">
                Боитесь?
              </p>
              <h3 className="mt-4 font-serif text-2xl leading-snug text-paper">
                Делегируйте рутину и займитесь собеседованиями
              </h3>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-paper">
                Первые приглашения приходят уже через 2–3 дня. Дальше всё зависит только от вашего
                опыта — умения заинтересовать работодателя и вести диалог.
              </p>
            </div>
            <Link
              href="/signup"
              className="-my-1 inline-flex min-h-11 w-fit items-center gap-2 border-b border-paper py-1 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent"
            >
              Получить первый оффер
              <span aria-hidden>→</span>
            </Link>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
