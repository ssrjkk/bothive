import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useState } from 'react';
import { StatusMessage } from '../src/components/dashboard/ui';

/**
 * StatusMessage: живая область для скринридера.
 *
 * Тонкость, из-за которой это проверяется поведением, а не чтением кода:
 * область и её текст должны появляться РАЗНЫМИ рендерами. Часть
 * скринридеров наблюдает за регионом и не объявляет вставку, если регион
 * возник в том же рендере, что и содержимое. Если рендерить
 * `{error ? <StatusMessage>{error}</StatusMessage> : null}`, сообщение
 * для скринридера просто не прозвучит.
 *
 * Раньше это было зафиксировано регуляркой по исходнику — то есть никак.
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

test('пустая область остаётся в DOM, чтобы поймать будущую вставку', async () => {
  await render(<StatusMessage>{null}</StatusMessage>);

  const region = dom.document.querySelector('[role="alert"]');
  assert.ok(region, 'живая область исчезла — вставка текста позже не будет объявлена');
  assert.equal(region.textContent, '');
});

test('текст подставляется в УЖЕ смонтированную область', async () => {
  function Harness() {
    const [error, setError] = useState<string | null>(null);
    return (
      <>
        <button type="button" onClick={() => setError('Сеть недоступна')}>
          Отправить
        </button>
        <StatusMessage>{error}</StatusMessage>
      </>
    );
  }

  await render(<Harness />);

  const before = dom.document.querySelector('[role="alert"]')!;
  assert.equal(before.textContent, '', 'до ошибки область должна быть пустой');

  act(() => {
    (dom.document.querySelector('button') as HTMLButtonElement).click();
  });

  const after = dom.document.querySelector('[role="alert"]')!;
  assert.equal(after.textContent, 'Сеть недоступна');
  // Ключевая проверка: это ТОТ ЖЕ узел, а не пересозданный. Только тогда
  // скринридер, наблюдающий за регионом, заметит изменение.
  assert.equal(after, before, 'область пересоздана — скринридер не увидит вставку');
});

test('ошибка объявляется настойчиво, подтверждение — вежливо', async () => {
  await render(<StatusMessage tone="error">Ошибка</StatusMessage>);
  const error = dom.document.querySelector('[role="alert"]')!;
  assert.equal(error.getAttribute('aria-live'), 'assertive');

  await render(<StatusMessage tone="success">Сохранено</StatusMessage>);
  const success = dom.document.querySelector('[role="status"]')!;
  assert.equal(
    success.getAttribute('aria-live'),
    'polite',
    'подтверждение не должно прерывать то, что скринридер читает сейчас',
  );
});

test('пустая область не занимает место в вёрстке', async () => {
  await render(
    <div>
      <StatusMessage>{null}</StatusMessage>
      <p>Следующий блок</p>
    </div>,
  );

  const region = dom.document.querySelector('[role="alert"]') as HTMLElement;
  // У <p> есть margin-block по умолчанию; между нажатием и ответом сервера
  // он оставлял бы заметный пробел в 16px.
  assert.match(region.className, /m-0/, 'пустая область должна обнулять отступы');
});

test('непустая область оформляется и видна', async () => {
  await render(<StatusMessage tone="error">Что-то пошло не так</StatusMessage>);

  const region = dom.document.querySelector('[role="alert"]') as HTMLElement;
  assert.equal(region.textContent, 'Что-то пошло не так');
  assert.doesNotMatch(region.className, /\bm-0\b/, 'оформление потеряно');
  assert.match(region.className, /border/, 'нет рамки — сообщение не читается как ошибка');
});
