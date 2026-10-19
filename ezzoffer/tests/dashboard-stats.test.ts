import test from 'node:test';
import assert from 'node:assert/strict';

import type { Stats } from '../src/lib/stats';

type Series = Stats['series'];

/**
 * dashboard/page.tsx показывал выдуманные числа: trend="+12%"/"+8%"/"+23%"/"+5%"
 * и таблицу «Статистика за неделю» с константами 12/18/15/20/8/3/0 — рядом с
 * реальными счётчиками из getStats. Обе витрины теперь считаются по series.
 */
function weeklyTrend(series: Series, key: 'sent' | 'viewed' | 'invited'): string | null {
  const totals = series.reduce(
    (acc, d) => {
      acc.sent += d.sent;
      acc.viewed += d.viewed;
      acc.invited += d.invited;
      return acc;
    },
    { sent: 0, viewed: 0, invited: 0 } as Record<'sent' | 'viewed' | 'invited', number>,
  );
  const total = totals[key];
  if (total === 0) return null;
  const week = Math.round(total / series.length);
  return week > 0 ? `~${week}/день` : null;
}

function weekRows(series: Series): { day: string; value: number; max: number }[] {
  const max = Math.max(1, ...series.map((d) => d.sent));
  return series.map((d) => ({ day: d.label, value: d.sent, max }));
}

function mk(over: Partial<Series[number]> = {}): Series[number] {
  return { label: '01.01', sent: 0, viewed: 0, invited: 0, ...over };
}

test('тренд выводится из реальных данных, а не из константы', () => {
  const series: Series = [mk({ sent: 10 }), mk({ sent: 20 })];
  const trend = weeklyTrend(series, 'sent');
  assert.equal(trend, '~15/день');
  assert.ok(!trend?.includes('12%'), 'фиктивные проценты больше не возвращаются');
});

test('пустая неделя даёт null, а не выдуманный процент', () => {
  const series: Series = Array.from({ length: 7 }, () => mk());
  assert.equal(weeklyTrend(series, 'sent'), null);
  assert.equal(weeklyTrend(series, 'invited'), null);
});

test('нулевая серия не делит на ноль', () => {
  assert.equal(weeklyTrend([], 'sent'), null);
});

test('недельные строки берутся из series, а не из хардкода', () => {
  const series: Series = [mk({ label: '01.10', sent: 3 }), mk({ label: '02.10', sent: 9 })];
  const rows = weekRows(series);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].value, 3);
  assert.equal(rows[1].value, 9);
  assert.equal(rows[0].max, 9, 'max берётся из максимума серии');
  assert.equal(rows[1].max, 9);
});

test('нулевая активность не ломает шкалу weekRows', () => {
  const rows = weekRows([mk(), mk()]);
  assert.ok(
    rows.every((r) => r.max >= 1),
    'max должен быть хотя бы 1, иначе деление на ноль',
  );
});

test('проценты шкалы не превышают 100', () => {
  const series: Series = [mk({ sent: 5 }), mk({ sent: 5 })];
  for (const row of weekRows(series)) {
    const pct = Math.min(100, Math.round((row.value / row.max) * 100));
    assert.ok(pct <= 100);
  }
});
