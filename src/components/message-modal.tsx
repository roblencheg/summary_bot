import { Modal, Loading, ErrorNote } from '~/components/ui/feedback';
import { useMessage } from '~/hooks/use-chats';
import { useTimezone } from '~/hooks/use-settings';
import { dt } from '~/lib/format';
import { CategoryChips } from '~/components/domain-badges';

/** Исходный текст без маскирования, результат анализа и редакции — только в веб-интерфейсе. */
export function MessageModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useMessage(id);
  const tz = useTimezone();
  return (
    <Modal open={id !== null} onClose={onClose} title={`Сообщение${data ? ` #${data.message.messageId}` : ''}`} wide>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote error={error} />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
            <span>
              <b className="text-ink">{data.message.authorName}</b>
              {data.message.authorUsername && ` @${data.message.authorUsername}`}
              {data.message.authorId && <span className="num"> · id {data.message.authorId}</span>}
              {data.message.isStaff && ' · сотрудник поддержки'}
              {data.message.identityLimited && ' · идентификация ограничена'}
            </span>
            <span className="num">отправлено {dt(data.message.sentAt, tz, true)}</span>
            <span className="num">получено {dt(data.message.receivedAt, tz, true)}</span>
            {data.message.link && (
              <a href={data.message.link} target="_blank" rel="noreferrer" className="font-semibold text-info underline">
                открыть в Telegram
              </a>
            )}
          </div>
          <p className="whitespace-pre-wrap rounded-xl border border-line bg-sunken/50 p-4 leading-relaxed">
            {data.message.hasText ? data.message.text : <i className="text-ink-soft">Вложение «{data.message.contentType}» без текста — содержимое не анализировалось</i>}
          </p>
          {data.analysis ? (
            <div className="space-y-2">
              <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">Анализ</p>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChips categories={data.message.categories} />
                <span className="text-[13px] text-ink-soft">
                  тема: {data.message.topic ?? '—'} · тон: {data.message.tone ?? '—'} · серьёзность: {data.message.severity ?? '—'} · уверенность:{' '}
                  {data.message.confidence ?? '—'}
                </span>
              </div>
              <p className="text-[12px] text-ink-mute">
                модель {data.analysis.model} · промпт {data.analysis.promptVersion} · правила {data.analysis.rulesVersion} · {dt(data.analysis.analyzedAt, tz, true)}
                {data.analysis.flags.length > 0 && <span className="text-signal"> · флаги: {data.analysis.flags.join(', ')}</span>}
              </p>
              <pre className="max-h-72 overflow-auto rounded-xl bg-night p-4 font-mono text-[11.5px] leading-relaxed text-[#c9cfdb]">
                {JSON.stringify(data.analysis.result, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-ink-soft">
              Анализ: {data.message.analysisStatus}
              {data.message.analysisError && ` — ${data.message.analysisError}`}
            </p>
          )}
          {data.revisions.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">Редакции</p>
              <ul className="space-y-2">
                {data.revisions.map((r, i) => (
                  <li key={i} className="rounded-lg border border-line p-3 text-[13px]">
                    <p className="num mb-1 text-ink-mute">
                      {dt(r.editedAt, tz, true)} {r.significant ? '· существенная — переанализировано' : '· несущественная'}
                    </p>
                    <p className="text-ink-soft line-through decoration-danger/50">{r.oldText}</p>
                    <p>{r.newText}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
