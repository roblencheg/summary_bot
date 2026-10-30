import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { Channel } from '~shared/domain';

const KEY = ['directorates'] as const;

export function useDirectorates(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: api.directorates.overview, enabled });
}

export function useDirectorateMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ['chats'] });
    qc.invalidateQueries({ queryKey: ['recipients'] });
    qc.invalidateQueries({ queryKey: ['admins'] });
  };
  return {
    create: useMutation({ mutationFn: (name: string) => api.directorates.create(name), onSuccess: done }),
    rename: useMutation({ mutationFn: (v: { id: number; name: string }) => api.directorates.rename(v.id, v.name), onSuccess: done }),
    createManager: useMutation({
      mutationFn: (v: { login: string; password: string; directorateIds: number[] }) => api.directorates.createManager(v.login, v.password, v.directorateIds),
      onSuccess: done,
    }),
    setManagerDirectorates: useMutation({ mutationFn: (v: { id: number; ids: number[] }) => api.directorates.setManagerDirectorates(v.id, v.ids), onSuccess: done }),
    setChatAccess: useMutation({
      mutationFn: (v: { chatId: number; directorateId: number; access: 'owner' | 'reader' | null }) => api.directorates.setChatAccess(v.chatId, v.directorateId, v.access),
      onSuccess: done,
    }),
    setQuietChats: useMutation({
      mutationFn: (v: { id: number; mode: 'line' | 'hide' | 'full' }) => api.directorates.setQuietChats(v.id, v.mode),
      onSuccess: () => {
        done();
        qc.invalidateQueries({ queryKey: ['auth'] });
      },
    }),
    setImportance: useMutation({
      mutationFn: (v: { chatId: number; importance: 'high' | 'normal' | 'low'; directorateId?: number }) =>
        api.chats.setImportance(v.chatId, v.importance, v.directorateId),
      onSuccess: done,
    }),
    managerPassword: useMutation({ mutationFn: (v: { id: number; password: string }) => api.admins.password(v.id, v.password), onSuccess: done }),
    managerDisabled: useMutation({ mutationFn: (v: { id: number; disabled: boolean }) => api.admins.setDisabled(v.id, v.disabled), onSuccess: done }),
  };
}

export function useClaimLink() {
  return useMutation({ mutationFn: (v: { directorateId?: number; channel: Channel }) => api.chats.claimLink(v.directorateId, v.channel) });
}
