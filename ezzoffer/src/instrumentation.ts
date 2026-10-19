/**
 * Instrumentation работает и в Edge, и в Node.
 *
 * Весь Node-код (process.on, планировщик, SQLite) вынесен в @/lib/bootstrap
 * и подключается динамическим import() уже после проверки NEXT_RUNTIME.
 *
 * Почему не «просто динамический импорт тут»: Turbopack анализирует тело
 * этого файла СТАТИЧЕСКИ, независимо от рантайм-проверки. Пока process.on и
 * setInterval стояли прямо в register(), сборка выдавала
 * "A Node.js API is used (process.on) which is not supported in the Edge
 * Runtime" — хотя в Edge код и не выполнялся. Вынос в отдельный модуль
 * убирает эти API из Edge-бандла целиком.
 *
 * Важно: turbopackIgnore на импортах ставить нельзя. Пометка оставляет
 * "@/lib/bootstrap" как есть, и в собранном сервере он не резолвится:
 * "Cannot find package '@/lib' imported from .next/standalone/...".
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startNodeRuntime } = await import('@/lib/bootstrap');
  await startNodeRuntime();
}

export function onRequestError(
  error: unknown,
  request: Readonly<{
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  }>,
  context: Readonly<{
    routerKind: 'Pages Router' | 'App Router';
    routePath: string;
    routeType: 'render' | 'route' | 'action' | 'proxy';
    renderSource?:
      'react-server-components' | 'react-server-components-payload' | 'server-rendering';
    revalidateReason: 'on-demand' | 'stale' | undefined;
  }>,
): void {
  const line = `[request:${context.routeType}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  const meta = `{"method":"${request.method}","path":"${request.path}","routePath":"${context.routePath}"}`;

  // В Edge файловых логов нет, поэтому только консоль — и без импорта логгера,
  // который протащил бы node:fs в Edge-бандл.
  const ts = new Date().toISOString();
  console.error(`[${ts}] [error] request:${context.routeType}: ${line} ${meta}`);
}
