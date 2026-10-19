import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { StatsPanel } from '../src/components/dashboard/stats-panel';
import type { Stats } from '../src/lib/stats';

/**
 * График динамики: легенда должна означать то же, что нарисовано.
 *
 * Это проверяется рендером, а не чтением исходника, потому что разойтись
 * могли именно два места в РАЗМЕТКЕ. В stats-panel ряд описывался двумя
 * независимыми списками: легенда красилась сырыми violet-500/cyan-400/
 * emerald-400, столбцы — токенами темы. Читающий код видел бы оба списка
 * рядом и, возможно, ничего не заметил; заметить можно только результат
 * рендера, где точка легенды фиолетовая, а столбец рядом — тёмно-синий.
 *
 * Раньше это проверялось регуляркой по файлу, что тоже ничего не значило:
 * такие регулярки ловят собственные комментарии и обходят template-литералы.
 */

let root: Root;
let container: HTMLElement;

/*
 * Один root на весь файл, а не новый в каждом beforeEach.
 *
 * StatsPanel держит setInterval(5000) в useEffect, который снимается при
 * размонтировании. Если создавать root заново на каждый тест, предыдущий
 * останется смонтирован — вместе со своим интервалом. Таймеры держат
 * event loop, и процесс не завершается: файл зависает целиком.
 *
 * Поэтому root один, между тестами размонтируем его (это снимает
 * интервал), а не заводим новый поверх старого.
 */
test.beforeEach(() => {
  if (root) act(() => root.unmount());
  dom.document.body.innerHTML = '';
  container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  root = createRoot(container);
});

test.after(() => {
  act(() => root.unmount());
  dom.cleanup();
});

const STATS = {
  today: 4,
  todayLimit: 50,
  sent: 120,
  viewed: 300,
  responded: 20,
  invited: 6,
  questions: 2,
  declined: 1,
  viewRate: 90,
  respondRate: 12,
  inviteRate: 5,
  series: [
    { label: 'пн', sent: 10, viewed: 30, invited: 2 },
    { label: 'вт', sent: 20, viewed: 40, invited: 1 },
    { label: 'ср', sent: 30, viewed: 20, invited: 3 },
  ],
} as unknown as Stats;

async function render(): Promise<void> {
  // Ставим глобалы до рендера: компонент опрашивает /api/stats по таймеру.
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: false,
    json: async () => ({}),
  });

  await act(async () => {
    root.render(<StatsPanel initial={STATS} />);
  });
}

/** Классы цвета (bg-*) легенды, по порядку. */
function legendColors(): string[] {
  return [...container.querySelectorAll('li > span[aria-hidden]')].map(
    (el) => [...el.classList].filter((c) => c.startsWith('bg-')).join(' ') || '',
  );
}

/** Классы цвета столбцов первого дня, по порядку. */
function firstDayBarColors(): string[] {
  const groups = container.querySelectorAll('[role="img"][aria-label]');
  return [...groups]
    .slice(0, 3)
    .map((el) => [...el.classList].filter((c) => c.startsWith('bg-')).join(' ') || '');
}

test('цвет точки легенды совпадает с цветом столбца', async () => {
  await render();

  const legend = legendColors();
  const bars = firstDayBarColors();

  assert.equal(legend.length, 3, `ожидались три ряда легенды, найдено ${legend.length}`);
  assert.equal(bars.length, 3, `ожидались три столбца, найдено ${bars.length}`);
  assert.deepEqual(
    bars,
    legend,
    `легенда и столбцы раскрашены по-разному:\n  легенда: ${legend.join(' | ')}\n  столбцы: ${bars.join(' | ')}`,
  );
});

test('ни легенда, ни столбцы не используют сырых цветов Tailwind', async () => {
  await render();

  const RAW =
    /\b(?:violet|indigo|purple|fuchsia|sky|blue|rose|pink|red|orange|amber|emerald|lime|teal|cyan|slate|gray|zinc)-\d{2,3}\b/;

  for (const el of container.querySelectorAll('[class]')) {
    const hit = [...el.classList].find((c) => RAW.test(c));
    assert.equal(
      hit,
      undefined,
      `элемент «${el.tagName}» покрашен сырым цветом ${hit} — мимо палитры, контраст не проверяется`,
    );
  }
});

test('данные столбца доступны с клавиатуры', async () => {
  await render();

  const bars = [...container.querySelectorAll('[role="img"][aria-label]')];
  assert.ok(bars.length > 0, 'столбцы не найдены');

  for (const bar of bars) {
    const label = bar.getAttribute('aria-label') ?? '';
    // Раньше данные были только в title: он не попадает в дерево
    // доступности, на клавиатуре недоступен и озвучивается выборочно.
    assert.match(
      label,
      /.+: (Отправлено|Просмотрено|Приглашения) — \d+/,
      `подпись столбца не читается вслух: «${label}»`,
    );
    assert.equal(
      bar.getAttribute('title'),
      null,
      'данные дублируются в title — который недоступен с клавиатуры',
    );
  }
});

test('высота столбца вычисляется, а не равна NaN', async () => {
  await render();

  const bars = [...container.querySelectorAll<HTMLElement>('[role="img"][aria-label]')];
  assert.ok(bars.length > 0, 'столбцы не найдены');

  for (const bar of bars) {
    const height = bar.style.height;
    assert.match(height, /^\d+(\.\d+)?%$/, `высота «${height}» не является процентом`);
  }
});

test('пустой ряд не даёт NaN% (max = 0)', async () => {
  const empty = {
    ...STATS,
    sent: 0,
    viewed: 0,
    invited: 0,
    series: [{ label: 'пн', sent: 0, viewed: 0, invited: 0 }],
  } as unknown as Stats;

  await act(async () => {
    root.render(<StatsPanel initial={empty} />);
  });

  const bars = [...container.querySelectorAll<HTMLElement>('[role="img"][aria-label]')];
  for (const bar of bars) {
    assert.doesNotMatch(
      bar.style.height,
      /NaN/,
      `высота «${bar.style.height}» — деление на max=0 дало NaN`,
    );
  }
});
