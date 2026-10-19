import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { OAuthButtons } from '../src/components/auth/oauth-buttons';

/**
 * Кнопки внешнего входа.
 *
 * Роут /api/auth/oauth/[provider] был написан и покрыт тестами, но интерфейса
 * для него не было: человек, зарегистрировавший OAuth-приложение, видел
 * страницу входа без единой кнопки и делал вывод, что оно не работает.
 *
 * Проверяется поведение, а не наличие разметки:
 * 1. готовый способ даёт ссылку и уводит по ней;
 * 2. НЕГОТОВЫЙ способ не показывается вовсе, а не показывается серым —
 *    отсутствие кнопки человек читает как «входа нет», а серую — как «сломано»;
 * 3. если сервер не ответил — видна причина, а не пустое место.
 */

let root: Root;
let container: HTMLElement;

before(() => {
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

/** Подменяет fetch на ответы по очереди. */
function stubFetch(responses: { status: number; body: unknown }[]): { called: string[] } {
  const real = globalThis.fetch;
  const called: string[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string) => {
    called.push(String(url));
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  test.after(() => {
    globalThis.fetch = real;
  });
  return { called };
}

test('готовый способ даёт ссылку и уводит по ней', async () => {
  const { called } = stubFetch([
    { status: 200, body: { url: 'https://github.com/login/oauth/authorize?x=1' } },
  ]);
  const assigned: string[] = [];

  await render(
    <OAuthButtons
      methods={[{ id: 'github', title: 'GitHub', ready: true }]}
      onNavigate={(u) => assigned.push(u)}
    />,
  );

  const button = [...container.querySelectorAll('button')].find((b) =>
    /GitHub/.test(b.textContent ?? ''),
  );
  assert.ok(button, 'кнопка GitHub не появилась');

  await act(async () => {
    (button as HTMLButtonElement).click();
  });

  assert.ok(
    called.some((c: string) => c.includes('/api/auth/oauth/github')),
    `роут не вызван: ${called}`,
  );
  assert.ok(
    assigned.some((u: string) => u.startsWith('https://github.com/')),
    `переход не выполнен: ${assigned}`,
  );
});

test('неготовый способ не показывается вовсе', async () => {
  stubFetch([{ status: 200, body: {} }]);
  await render(
    <OAuthButtons
      methods={[
        { id: 'google', title: 'Google', ready: false },
        { id: 'github', title: 'GitHub', ready: true },
      ]}
    />,
  );

  const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
  assert.ok(
    labels.some((l) => /GitHub/.test(l)),
    'готовый способ должен быть',
  );
  assert.ok(
    !labels.some((l) => /Google/.test(l)),
    `неготовый способ показан как кнопка: ${labels.join(' | ')}`,
  );
});

test('если способов нет вовсе — блок не рисуется', async () => {
  stubFetch([{ status: 200, body: {} }]);
  await render(<OAuthButtons methods={[]} />);
  assert.equal(
    container.querySelector('[data-oauth-buttons]'),
    null,
    'нарисован пустой блок внешнего входа без единой кнопки',
  );
});

test('ответ сервера без url показывается как причина, а не молча', async () => {
  stubFetch([{ status: 503, body: { error: 'Этот способ входа не настроен на сервере' } }]);
  await render(<OAuthButtons methods={[{ id: 'github', title: 'GitHub', ready: true }]} />);

  await act(async () => {
    (
      [...container.querySelectorAll('button')].find((b) =>
        /GitHub/.test(b.textContent ?? ''),
      ) as HTMLButtonElement
    ).click();
  });

  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert, 'нет области сообщения');
  assert.match(
    alert.textContent ?? '',
    /не настроен/,
    `причина не показана: «${alert.textContent}»`,
  );
});
