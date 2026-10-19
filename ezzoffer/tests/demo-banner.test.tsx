import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DemoBanner } from '../src/components/dashboard/demo-banner';

/**
 * Фаза 1, задача 3: человек не должен принять демо-цифры за живые.
 *
 * Принцип P1 карты: у каждого факта есть происхождение, и лучше отсутствие,
 * чем неправда. Демо-режим — это не украшение и не отметка «beta»: это
 * утверждение «эти числа не отражают ответы площадок». Поэтому проверяется
 * поведение баннера, а не наличие класса в разметке.
 *
 * Важно, что баннер проверяется в двух состояниях. Баннер, который виден
 * всегда, опаснее отсутствующего: он делает живые данные сомнительными и
 * учит человека игнорировать пометку.
 */

let root: Root;
let container: HTMLElement;

test.beforeEach(() => {
  dom.document.body.innerHTML = '';
  container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  root = createRoot(container);
});

test.after(() => {
  act(() => root.unmount());
  dom.cleanup();
});

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

test('в demo баннер виден и говорит, что данные не реальные', async () => {
  await render(<DemoBanner mode="demo" />);

  const banner = container.querySelector('[data-demo-banner]');
  assert.ok(banner, 'в demo баннера нет — человек не отличит демо от живого');

  const text = banner.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  assert.ok(text.length > 20, `текст баннера слишком короткий: «${text}»`);
  assert.match(text, /демо|демонстрац/i, `баннер не называет режим: «${text}»`);
  assert.match(
    text,
    /не реальн|ненастоящ|демонстрационн/i,
    `баннер не говорит, что данные не реальные: «${text}»`,
  );
});

test('в live баннера нет', async () => {
  await render(<DemoBanner mode="live" />);
  assert.equal(
    container.querySelector('[data-demo-banner]'),
    null,
    'в live баннер demo остался на странице — живые данные выглядят сомнительными',
  );
});

test('баннер ведёт в настройки, где режим переключается', async () => {
  await render(<DemoBanner mode="demo" />);

  const link = container.querySelector('[data-demo-banner] a');
  assert.ok(link, 'в баннере нет ссылки — переключить режим неоткуда');
  assert.match(
    link.getAttribute('href') ?? '',
    /\/dashboard\/settings/,
    'ссылка ведёт не в настройки',
  );
});
