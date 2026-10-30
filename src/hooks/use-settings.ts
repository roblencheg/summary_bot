import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { GlobalSettingsDto } from '~shared/schemas';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
}

export function useSettingsMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (s: GlobalSettingsDto) => api.settings.save(s),
      onSuccess: (data) => {
        qc.setQueryData(['settings'], data);
        qc.invalidateQueries({ queryKey: ['chats'] });
        qc.invalidateQueries({ queryKey: ['context'] });
      },
    }),
    backup: useMutation({ mutationFn: api.settings.backup, onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }) }),
  };
}

/** Общий контекст для любой роли: часовой пояс, расписание, бот, правила по умолчанию. */
export function useAppContext() {
  return useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 5 * 60_000 });
}

/** Часовой пояс расписания — для отображения времени во всём интерфейсе. */
export function useTimezone(): string {
  return useAppContext().data?.timezone ?? 'Asia/Novosibirsk';
}
