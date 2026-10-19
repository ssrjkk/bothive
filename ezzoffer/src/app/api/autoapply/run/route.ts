import { NextResponse } from 'next/server';
import { runAutoApply } from '@/lib/autoapply';
import { saveLastRun } from '@/lib/autoapply-store';
import { NO_STORE_HEADERS } from '@/lib/http';
import { acquireLock, releaseLock, lockHeldAt } from '@/lib/scheduler';
import { db } from '@/lib/db';

/*
 * Запуск автооткликов по требованию. Защищён CRON_SECRET (или переданным ключом),
 * чтобы злоумышленник не мог дёргать воркер произвольно.
 *
 * Запуск берёт ту же блокировку, что и планировщик. Раньше он вызывал
 * runAutoApply напрямую, мимо acquireLock, и это приводило к двум
 * одновременным прогонам — планировщику по расписанию и этому ручному.
 *
 * Дубли не были фантастикой. Защита от повторной отправки проверяет наличие
 * строки в applications, и проверка происходит ДО сетевого вызова в hh:
 *
 *     SELECT id FROM applications WHERE user_id = ? AND job_slug = ? ...
 *     ...
 *     await hhProvider.apply(vacancy, ...)   ← здесь оба прогона ждут сеть
 *     INSERT INTO applications ...
 *
 * Между SELECT и INSERT есть await сетевого запроса. Два прогона проходят
 * проверку одновременно, оба отправляют отклик, оба вставляют строку. Человек
 * получает два отклика на одну вакансию от своего имени — а это ровно то, за
 * что площадка блокирует аккаунт.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET не настроен' }, { status: 503 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
  }

  const now = Date.now();
  if (!acquireLock(db, now)) {
    /*
     * 409, а не запуск «вторым». Молчаливый запуск здесь означал бы ровно то,
     * ради чего блокировка и нужна: два прогона в одном процессе.
     *
     * В ответе — когда метка появилась: по ней видно, идёт ли сейчас плановый
     * тик (обычное дело, ждать минуту) или блокировка зависла после сбоя (тогда
     * она спадёт сама по TTL в 30 минут).
     */
    const heldAt = lockHeldAt(db);
    return NextResponse.json(
      {
        error: 'Прогон уже выполняется',
        running: true,
        // Метка — время начала текущего прогона, а не остаток.
        startedAt: heldAt || null,
      },
      {
        status: 409,
        headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' },
      },
    );
  }

  let result;
  try {
    result = await runAutoApply();
    /*
     * Ручной запуск сохраняется так же, как плановый.
     *
     * Иначе прогон по требованию виден только в ответе этому запросу, а панель
     * в кабинете продолжала бы показывать предыдущий плановый итог — то есть
     * человек нажал «запустить», откликов прибавилось, а на экране ничего не
     * изменилось. Тишина в интерфейсе после действия читается как поломка.
     */
    saveLastRun(result);
  } finally {
    releaseLock(db, now);
  }
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
