import { Reveal } from '@/components/reveal';
import { limits } from '@/lib/data';

/*
 * Бывшие «Истории успеха» — вторая копия выдуманных отзывов.
 *
 * На тёмной полосе стояли три несуществующих человека: «Анна, менеджер
 * продукта», «Максим, frontend-разработчик», «Рутем, python-разработчик» —
 * с результатами «Оффер через 2 недели» и «80+ приглашений, 4 оффера».
 * На инверсной полосе такие врезки читаются как свидетельство, то есть
 * именно как то, чем они не были.
 *
 * Полоса осталась по причинам, которые никуда не делись: на главной
 * четырнадцать секций подряд одинаковой волосяной линейкой, и без одной
 * инверсии глаз перестаёт различать блоки. К десятому экрану всё выглядит
 * одинаково.
 *
 * Содержимое — то, чего сервис не умеет. Список ограничений стоит дороже
 * похвалы: он объясняет, почему остальному можно верить, и человек понимает
 * границы до того, как потратит деньги. Каждый пункт проверяется по коду.
 */
export function Limits() {
  return (
    <section className="bg-ink py-20 md:py-28">
      <div className="container-x">
        <div className="max-w-3xl">
          {/* Метка на тёмном фоне — красная заливка читается, но канцелярская
              прописная строка на чернилах была бы почти неразличима. */}
          <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-paper">
            <span aria-hidden className="block h-px w-7 bg-accent" />
            Границы сервиса
          </p>
          <h2 className="mt-4 text-balance font-serif text-3xl leading-snug text-paper md:text-5xl">
            Что EZOffer <span className="text-accent-on-dark">не умеет</span>
          </h2>
          <p className="measure mt-5 text-base leading-relaxed text-paper md:text-lg">
            Здесь перечислено то, что сервис делать не может или не делает. Раньше на этом месте
            стояли истории успеха с именами, компаниями и результатами — их не существовало, поэтому
            они убраны, а вместо них показаны настоящие ограничения. Всё ниже проверяется по коду, а
            не по обещанию.
          </p>
        </div>

        <div className="mt-12 grid gap-x-8 gap-y-10 border-t border-paper/25 pt-8 md:grid-cols-3">
          {limits.map((limit, idx) => (
            <Reveal key={limit.title} delay={idx * 80}>
              <article className="flex h-full flex-col">
                {/* Заголовок антиквой: на тёмном фоне он становится главным
                    элементом врезки, как заголовок в журнале. */}
                <h3 className="font-serif text-lg leading-snug text-paper">{limit.title}</h3>
                <p className="mt-4 flex-1 leading-relaxed text-paper">{limit.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
