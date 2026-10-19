import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';

export const metadata: Metadata = {
  title: 'Правила платформ и безопасность аккаунта',
  description:
    'Как EZOffer работает в рамках правил hh.ru и других платформ, что делать для снижения рисков и как мгновенно поставить автоотклики на паузу.',
};

const rules = [
  {
    h: 'Отклики отправляются от вашего имени',
    p: 'EZOffer использует официальный API платформы и вашу учётную запись. Работодатель видит обычный отклик — без пометки «автоматический».',
  },
  {
    h: 'Мы храним токен доступа к вашему аккаунту',
    p: 'Без этого отклики отправить нельзя: сервис обращается к платформе от вашего имени. Токен хранится в нашей базе, пока вы не отвяжете аккаунт или не отзвёте доступ на стороне платформы. Отзыв доступа блокирует и синхронизацию.',
  },
  {
    h: 'Мы выдерживаем темп, чтобы не выглядеть ботом',
    p: 'Сервис отправляет отклики не подряд, а с паузами: случайный интервал от 45 секунд до 3 минут, рабочие часы по вашему часовому поясу, лимит в 50 откликов в сутки и 12 в час. Это сделано, чтобы платформа не распознала автоматизацию.',
  },
  {
    h: 'Риск блокировки всё равно есть',
    p: 'Даже с такими паузами массовые автоматические отклики могут нарушать правила платформы. Лимиты уменьшают риск, но не исключают его, и ответственность за аккаунт остаётся на вас.',
  },
  {
    h: 'Мгновенная пауза',
    p: 'В любой момент вы можете остановить автоотклики одной кнопкой в кабинете. Все активные поиски переводятся в статус «Пауза» без удаления настроек.',
  },
];

const cautions = [
  'Не гонитесь за потолком лимитов — умеренный темп безопаснее.',
  'Откликайтесь на релевантные вакансии, а не «во всё подряд».',
  'Поддерживайте живую активность профиля: отвечайте в чатах, обновляйте резюме.',
  'При любом предупреждении платформы немедленно ставьте автоотклики на паузу.',
];

/*
 * Правила платформ.
 *
 * Страница юридическая: её читают целиком, по порядку, и чаще всего
 * ищут конкретный пункт. Прежний вид — четыре одинаковые карточки с
 * заливкой плюс жёлтая коробка «Важно понимать»: карточки не имеют
 * нумерации, поэтому пункт, на который ссылаются, невозможно назвать.
 *
 * Теперь это документ: нумерованные разделы через линейку, заголовок
 * антиквой, предупреждение — отдельной инверсной полосой, чтобы его
 * невозможно было пропустить.
 *
 * Отдельно про тон: прежний пункт «Мы не обходим защиту платформ»
 * противоречил коду. anti-ban.ts реализует именно обходное поведение —
 * джиттер 45–180 секунд, рабочие часы 9:00–20:00, суточный лимит, —
 * чтобы отклики не попадали под антибот. Формулировка ниже описывает,
 * что сервис делает на самом деле.
 */
export default function PlatformRulesPage() {
  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <Eyebrow>Безопасность</Eyebrow>
        <h1 className="display mt-4 max-w-4xl text-balance text-4xl md:text-6xl">
          Правила платформ и <span className="text-accent">безопасность аккаунта</span>
        </h1>
        <p className="measure mt-6 text-base leading-relaxed text-muted md:text-lg">
          Честная позиция EZOffer: мы автоматизируем рутину в рамках официальных механизмов, но вы
          обязаны понимать правила платформы, на которой ищете работу.
        </p>
      </Section>

      <Section className="pt-0">
        <div className="border-t-2 border-ink">
          <ol>
            {rules.map((r, idx) => (
              <Reveal as="li" key={r.h} delay={idx * 60} className="border-b border-line py-8">
                <div className="grid gap-x-10 gap-y-2 md:grid-cols-12">
                  <p className="font-mono text-sm tabular-nums text-accent md:col-span-1">
                    {String(idx + 1).padStart(2, '0')}
                  </p>
                  <div className="md:col-span-11">
                    <h2 className="font-serif text-xl leading-snug text-ink md:text-2xl">{r.h}</h2>
                    <p className="measure mt-3 text-sm leading-relaxed text-muted md:text-base">
                      {r.p}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>

        <div className="mt-14 bg-ink px-7 py-9 md:px-10 md:py-11">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper">
            Важно понимать
          </p>
          <h2 className="mt-3 font-serif text-xl leading-snug text-paper md:text-2xl">
            Четыре правила, которые снижают риск блокировки
          </h2>
          <ul className="mt-6 grid gap-x-10 gap-y-3 md:grid-cols-2">
            {cautions.map((c) => (
              <li key={c} className="flex gap-3 text-sm leading-relaxed text-paper">
                <span aria-hidden className="mt-2 size-1 shrink-0 bg-accent" />
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 border-t-2 border-ink pt-8">
          <h2 className="font-serif text-2xl md:text-3xl">Поставить автоотклики на паузу</h2>
          <p className="measure mt-3 leading-relaxed text-muted">
            Это делается в кабинете одним переключателем — настройки поисков при этом сохраняются, и
            вернуться к откликам можно в любой момент.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Перейти в кабинет
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/faq"
              className="inline-flex min-h-11 items-center gap-2 border-b border-ink py-1 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Частые вопросы
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
