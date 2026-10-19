import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ModeSwitch } from '../src/components/dashboard/mode-switch';

/**
 * Переключатель demo|live в настройках (Фаза 1, задача 3).
 *
 * Роут `/api/mode` написан, но без кнопки он недостижим: режим нельзя было
 * переключить из интерфейса. Эта проверка смотрит на действие, а не на текст
 * кнопки: текст можно сделать красивым и при этом ничего не отправлять — так
 * и было с командами бота (`telegram-commands.test.ts`).
 *
 * Главное здесь — отказ площадки. «Включить живой режим» без подключённого hh
 * обязан показывать причину, а не рапортовать об успехе: сломанный переключатель
 * выглядит как «включил, но не работает» и человек ищет ошибку не там.
 */

let root: Root;
let container: HTMLElement;
const realFetch = globalThis.fetch;

type Call = { url: string; body: unknown };

test.beforeEach(() => {
  dom.document.body.innerHTML = '';
  container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  root = createRoot(container);
});

test.after(() => {
  act(() => root.unmount());
  dom.cleanup();
  globalThis.fetch = realFetch;
});

/** Подмена fetch: отвечает заданным статусом и считает вызовы. */
function stubFetch(status: number, payload: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** Кнопка, по которой реально щёлкает человек. */
function button(label: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? ''),
  );
  assert.ok(
    found,
    `нет кнопки под ${label}: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`,
  );
  return found as HTMLButtonElement;
}

test('из demo отправляется явный запрос на live', async () => {
  const calls = stubFetch(200, { mode: 'live' });
  await render(<ModeSwitch initialMode="demo" hhConnected />);

  await act(async () => {
    button(/включ/i).click();
  });

  const post = calls.find((c) => c.url.includes('/api/mode'));
  assert.ok(post, `переход в live не отправил запрос: ${JSON.stringify(calls)}`);
  assert.deepEqual(post.body, { mode: 'live' }, "в запросе должно быть ровно { mode: 'live' }");
  assert.match(
    container.textContent ?? '',
    /жив/i,
    'после перехода интерфейс не показал живой режим',
  );
});

/*
 * hh был подключён на момент отрисовки и перестал работать к моменту клика:
 * токен истёк, площадка отозвала доступ, пользователь отключил аккаунт в другой
 * вкладке. Сервер — единственное место, где проверка обязательна, поэтому
 * интерфейс обязан показать причину отказа, а не рапортовать об успехе.
 */
test('отказ площадки показывается, а не проглатывается', async () => {
  stubFetch(400, { error: 'Сначала подключите аккаунт hh.ru в разделе «Настройки»' });
  await render(<ModeSwitch initialMode="demo" hhConnected />);

  await act(async () => {
    button(/включ/i).click();
  });

  /*
   * Проверяется живая область, а не весь текст панели. Раньше здесь стояло
   * `assert.match(text, /hh\.ru/)` по textContent — и оно проходило всегда,
   * потому что «статусы приходят только от hh.ru» есть в статическом пояснении
   * на панели. Такая проверка не ловит ничего: при сломанной обработке отказа
   * (мутация `!res.ok && false`) текст всё равно содержал hh.ru.
   */
  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert, 'область сообщения об ошибке исчезла');
  assert.match(
    alert.textContent ?? '',
    /Сначала подключите аккаунт hh\.ru/,
    `в область попало не сообщение сервера: «${alert.textContent}»`,
  );
  assert.equal(
    container.querySelector('[data-mode-switch]')?.getAttribute('data-mode-switch'),
    'demo',
    'после отказа интерфейс заявил, что переключился в live',
  );
});

test('без подключённого hh кнопка live не предлагается', async () => {
  const calls = stubFetch(200, { mode: 'live' });
  await render(<ModeSwitch initialMode="demo" hhConnected={false} />);

  const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
  assert.ok(
    buttons.every((b) => !/включ/i.test(b)),
    `кнопка live предложена без подключённого hh: ${buttons.join(' | ')}`,
  );
  assert.equal(calls.length, 0, 'компонент что-то отправил при рендере');
});

test('возврат в demo доступен и уходит тем же роутом', async () => {
  const calls = stubFetch(200, { mode: 'demo' });
  await render(<ModeSwitch initialMode="live" hhConnected />);

  await act(async () => {
    button(/демо/i).click();
  });

  const post = calls.find((c) => c.url.includes('/api/mode'));
  assert.ok(post, 'возврат в demo не отправил запрос');
  assert.deepEqual(post.body, { mode: 'demo' });
});
