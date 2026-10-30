import { CATEGORIES, CATEGORY_LABELS, SEVERITIES, SEVERITY_LABELS, type Category, type Severity } from '~shared/domain';
import type { ChatRulesDto } from '~shared/schemas';
import { Checkbox, Field, Input, Select } from '~/components/ui/form';

type NumKey = Exclude<keyof ChatRulesDto, 'categories' | 'minSeverity'>;

const NUM_FIELDS: Array<{ key: NumKey; label: string; hint: string; step?: number }> = [
  { key: 'minConfidence', label: 'Порог уверенности', hint: '0…1. Ниже — «пограничный», без рассылки', step: 0.05 },
  { key: 'cooldownMin', label: 'Пауза между уведомлениями, мин', hint: 'Повторы в это время копятся без уведомлений' },
  { key: 'repeatCount', label: 'Повтор: сообщений', hint: 'Столько связанных сообщений…' },
  { key: 'repeatWindowMin', label: 'Повтор: окно, мин', hint: '…за это окно = повторяющаяся ситуация' },
  { key: 'authorRepeatHours', label: 'Повтор автора, ч', hint: 'Новое обращение того же автора по нерешённой проблеме' },
  { key: 'massAuthors', label: 'Массовая: авторов', hint: 'Разных участников по одной проблеме…' },
  { key: 'massWindowMin', label: 'Массовая: окно, мин', hint: '…за это окно' },
  { key: 'spikeWindowMin', label: 'Всплеск: окно, мин', hint: 'Скользящее окно подсчёта' },
  { key: 'spikeMinMessages', label: 'Всплеск: минимум', hint: 'Абсолютный минимум сообщений в окне' },
  { key: 'spikeRatio', label: 'Всплеск: кратность', hint: 'Рост к обычному уровню того же времени суток', step: 0.5 },
  { key: 'historyDays', label: 'История для базы, дн', hint: 'До накопления — только абсолютный порог' },
  { key: 'noReplyWindowMin', label: 'Ожидание ответа, мин', hint: 'После — «возможно, без ответа»' },
];

export function RulesEditor({ value, onChange, defaults }: { value: ChatRulesDto; onChange: (v: ChatRulesDto) => void; defaults?: ChatRulesDto }) {
  const set = <K extends keyof ChatRulesDto>(k: K, v: ChatRulesDto[K]) => onChange({ ...value, [k]: v });
  const differs = (k: keyof ChatRulesDto) => defaults && JSON.stringify(defaults[k]) !== JSON.stringify(value[k]);
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">
          Категории алертов {differs('categories') && <span className="text-signal">· изменено</span>}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Checkbox
              key={c}
              label={CATEGORY_LABELS[c]}
              checked={value.categories.includes(c)}
              onChange={(on) => set('categories', on ? [...value.categories, c] : value.categories.filter((x: Category) => x !== c))}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={<>Мин. серьёзность {differs('minSeverity') && <span className="text-signal">· изм.</span>}</>} hint="Ниже — алерт не отправляется">
          <Select value={value.minSeverity} onChange={(e) => set('minSeverity', e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {NUM_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={
              <>
                {f.label} {differs(f.key) && <span className="text-signal">· изм.</span>}
              </>
            }
            hint={`${f.hint}${defaults ? ` · по умолчанию ${defaults[f.key]}` : ''}`}
          >
            <Input
              type="number"
              step={f.step ?? 1}
              value={value[f.key]}
              onChange={(e) => set(f.key, e.target.value === '' ? 0 : Number(e.target.value))}
              className="num"
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/** Только поля, отличающиеся от глобальных значений, — это и есть переопределение чата. */
export function diffRules(value: ChatRulesDto, defaults: ChatRulesDto): Partial<ChatRulesDto> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value) as Array<keyof ChatRulesDto>) {
    if (JSON.stringify(value[k]) !== JSON.stringify(defaults[k])) out[k] = value[k];
  }
  return out as Partial<ChatRulesDto>;
}
