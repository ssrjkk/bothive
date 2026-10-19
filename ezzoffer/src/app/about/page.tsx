import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, SectionHead, Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { team, stats } from '@/lib/data';

export const metadata: Metadata = {
  title: 'О нас',
  description:
    'О EZOffer: как устроен сервис автоматических откликов, какие у него ограничения и кто его делает.',
};

const values = [
  {
    title: 'Время дороже кликов',
    text: 'Поиск работы не должен съедать часы. Мы автоматизируем всё, что допустимо автоматизировать, и оставляем человеку главное — собеседования и выбор.',
  },
  {
    title: 'Честные цифры',
    text: 'Никаких «магических кнопок». Мы показываем воронку откликов как есть и помогаем чинить то, что реально мешает приглашениям.',
  },
  {
    title: 'В рамках правил',
    // Прежний текст — «никаких серых схем, рисков и блокировок» — обещал
    // отсутствие блокировок, которых не существует: лимиты и паузы лишь
    // снижают риск. Формулировка ниже не отрицает его, а называет цену.
    text: 'Отклики идут через официальный API платформы. Мы выдерживаем паузы и лимиты, чтобы не выглядеть ботом, но блокировка остаётся возможной — об этом написано в правилах платформ.',
  },
  {
    title: 'Пользователь — владелец',
    text: 'Вы решаете, на какие вакансии откликаться и что отправлять. Сервис исполняет, а не управляет вашим профилем.',
  },
];

export default function AboutPage() {
  return (
    <>
      <Section className="pb-8 pt-14 md:pt-20">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Eyebrow>Команда и миссия</Eyebrow>
            <h1 className="display mt-6 text-4xl text-balance md:text-6xl">
              Мы вернули себе <span className="text-accent">часы жизни</span>
            </h1>
          </div>
          <div className="flex items-end lg:col-span-5">
            {/*
              Лид вынесен в правую колонку и набран крупнее, чем раньше.
              На «о нас» главное — почему мы, а не чем занимаемся; раньше
              текст шёл узкой колонкой под центрированным заголовком.
            */}
            <p className="text-lg leading-relaxed text-ink">
              Каждый из нас проходил через десятки ручных откликов, автоотказы и бесконечное
              ожидание. И решил построить инструмент, который делает поиск работы управляемым
              процессом, а не лотереей.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHead eyebrow="Принципы" title={<>Чем мы руководствуемся</>} />
        {/* Принципы — не карточки: это нумерованный перечень, где порядок
            и есть аргумент. */}
        <ol className="grid gap-x-8 gap-y-8 border-t border-line pt-8 sm:grid-cols-2">
          {values.map((value, idx) => (
            <Reveal key={value.title} delay={idx * 60} as="li">
              <div className="h-full">
                <span className="font-mono text-sm tabular-nums text-accent">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 font-serif text-xl leading-snug">{value.title}</h3>
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted md:text-base">
                  {value.text}
                </p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHead
          eyebrow="Результаты"
          title={
            <>
              Цифры, которыми мы <span className="text-accent">гордимся</span>
            </>
          }
        />
        {/* Цифры моноширинным и с линейкой сверху: раньше это были
            «стеклянные» плитки, где число и подпись терялись. */}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-10 border-t border-line pt-8 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="border-t-2 border-ink pt-4">
              <dt className="font-mono text-3xl tabular-nums text-ink md:text-4xl">{stat.value}</dt>
              <dd className="mt-2 max-w-[22ch] text-sm leading-snug text-muted">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section className="border-t border-line bg-surface-2">
        <SectionHead
          eyebrow="Команда"
          title={
            <>
              Кто делает <span className="text-accent">EZOffer</span>
            </>
          }
          sub="Небольшая команда с фокусом на результат — как вы на поиске работы"
        />
        <div className="grid gap-x-8 gap-y-10 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-4">
          {team.map((member, idx) => (
            <Reveal key={member.name} delay={idx * 70}>
              <article className="h-full">
                <p className="font-mono text-xs tracking-[0.14em] text-muted">{member.initials}</p>
                <h3 className="mt-3 font-serif text-xl leading-snug">{member.name}</h3>
                <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-accent">
                  {member.role}
                </p>
                <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">{member.bio}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section>
        <div className="bg-ink px-8 py-12 md:px-14 md:py-16">
          <h2 className="font-serif text-2xl leading-snug text-paper md:text-3xl">
            Готовы попробовать?
          </h2>
          <p className="measure mt-4 leading-relaxed text-paper">
            24 часа бесплатного доступа. Улучшенное резюме, подбор вакансий и первые автоотклики —
            уже сегодня.
          </p>
          <div className="mt-8">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-sm bg-paper px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
            >
              Начать бесплатно
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
