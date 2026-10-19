import Link from 'next/link';
import { Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';

/*
 * Финальный призыв.
 *
 * Прежняя версия — скруглённый на 2rem прямоугольник с двумя размытыми
 * пятнами, сеткой на фоне и центрированным текстом: самый узнаваемый вид
 * финального экрана у ИИ-лендингов.
 *
 * Теперь это полоса на всю ширину, как объявление в конце газетной полосы:
 * чёрная подложка, линейка сверху, текст слева, действие справа. Никакой
 * симметрии — она и несла весь шаблонный вид.
 */

export function CtaBanner() {
  return (
    <section className="border-t border-line">
      <Reveal>
        <div className="grid gap-10 bg-ink px-7 py-14 md:grid-cols-12 md:items-end md:px-14 md:py-16">
          <div className="md:col-span-8">
            <Eyebrow className="text-paper">Начните путь к лучшему офферу</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl leading-snug text-paper text-balance md:text-5xl">
              Завтра за вас откликнется{' '}
              {/*
                accent-on-dark, а не accent-2.

                Это ровно тот случай, о котором предупреждает сама тема
                (globals.css, --color-accent-on-dark): один оттенок не может
                быть одновременно фоном под белый текст и текстом на чернилах.
                `--color-accent-2` (#1f3a5f) на `bg-ink` (#15130f) даёт 1.62:1
                при требуемых 3:1 для крупного текста — слово «агент» было
                практически не видно.
              */}
              <span className="text-accent-on-dark">агент</span>
            </h2>
            <p className="measure mt-6 text-base leading-relaxed text-paper">
              24 часа бесплатного доступа без привязки карты. Пока другие соискатели кликают
              вручную, вы уже на собеседовании.
            </p>
          </div>

          <div className="md:col-span-4 md:text-right">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-sm bg-paper px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
            >
              Попробовать бесплатно
              <span aria-hidden>→</span>
            </Link>
            <p className="mt-4 font-mono text-xs text-paper">
              Отмена в один клик · деньги не спишутся без подписки
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
