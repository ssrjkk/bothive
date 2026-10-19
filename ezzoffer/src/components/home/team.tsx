import { Section, SectionHead, PrimaryButton } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { team } from '@/lib/data';

export function Team() {
  return (
    <Section>
      <SectionHead
        eyebrow="О нас"
        title={
          <>
            Маленькая команда, <span className="text-accent">большой результат</span>
          </>
        }
        sub="Мы сами прошли через десятки ручных откликов — и собрали инструмент, который вернул нам часы жизни"
      />

      {/*
        Круглые аватары из градиентов с подъёмом при наведении ничего не
        сообщали о людях. Теперь это список: инициалы моноширинным, имя
        антиквой, должность акцентом.
      */}
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

      <Reveal delay={100}>
        <div className="mt-12">
          <PrimaryButton href="/about">Узнать больше о нас</PrimaryButton>
        </div>
      </Reveal>
    </Section>
  );
}
