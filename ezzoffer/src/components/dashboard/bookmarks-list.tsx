import { Badge, Panel, StatusMessage, btnGhost, EmptyState } from '@/components/dashboard/ui';

/**
 * Избранные вакансии.
 *
 * Отдельная страница, а не фильтр в подборе: человек возвращается к закладкам
 * не за поиском, а чтобы решить, откликаться ли. Смешивать это с подбором
 * означало бы терять их при каждой смене условий.
 *
 * Сервер отдаёт готовые данные, включая признак `available`. Вакансия могла
 * исчезнуть из каталога за время, пока она лежала в закладках, и это показано
 * прямо: пустая карточка с кнопкой «откликнуться» выглядела бы как поломка.
 */

type Bookmark = {
  slug: string;
  createdAt: number;
  available: boolean;
  title: string | null;
  company: string | null;
  salary: string | null;
  city: string | null;
  sourceUrl: string | null;
  publishedAt: number | null;
};

export function BookmarksList({ bookmarks }: { bookmarks: Bookmark[] }) {
  if (bookmarks.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Избранного пока нет"
          text="Нажмите «В избранное» у вакансии в подборе — она останется здесь, даже когда каталог обновится."
        />
      </Panel>
    );
  }

  const gone = bookmarks.filter((b) => !b.available);

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-sm text-muted">
          Сохранено вакансий: {bookmarks.length}. Закладка хранит ссылку, а не копию: открыв её, вы
          увидите, что там сейчас — зарплату, компанию и статус.
        </p>
      </Panel>

      {gone.length > 0 ? (
        <StatusMessage tone="notice">
          {gone.length === 1
            ? 'Одна сохранённая вакансия больше не в каталоге — скорее всего, она закрыта.'
            : `${gone.length} сохранённых вакансий больше не в каталоге — скорее всего, они закрыты.`}
        </StatusMessage>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {bookmarks.map((b) => (
          <article
            key={b.slug}
            className="flex flex-col gap-3 rounded-sm border border-line bg-surface-2 p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-serif leading-snug text-ink">
                  {b.title ?? 'Вакансия ушла с площадки'}
                </h2>
                {b.company ? (
                  <p className="mt-0.5 text-sm text-muted">
                    {b.company}
                    {b.city ? ` · ${b.city}` : ''}
                  </p>
                ) : null}
              </div>
              <Badge tone={b.available ? 'success' : 'warn'}>
                {b.available ? 'В каталоге' : 'Закрыта'}
              </Badge>
            </div>

            {b.salary ? <p className="text-lg font-semibold text-accent-2">{b.salary}</p> : null}

            <p className="text-xs text-muted">
              Сохранено{' '}
              {new Date(b.createdAt).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
              })}
              {b.publishedAt
                ? ` · опубликована ${new Date(b.publishedAt).toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                  })}`
                : ''}
            </p>

            <div className="mt-auto flex flex-wrap gap-2">
              {b.available ? (
                <>
                  <a href={`/jobs/${encodeURIComponent(b.slug)}`} className={btnGhost}>
                    Открыть вакансию
                  </a>
                  {b.sourceUrl ? (
                    <a
                      href={b.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={btnGhost}
                    >
                      На сайте
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-muted">
                  Отклик уже невозможен — вакансия закрыта или снята.
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
