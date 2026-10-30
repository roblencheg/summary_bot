import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { CreateRecipientInput, UpdateRecipientInput } from '~shared/schemas';
import type { Channel } from '~shared/domain';

const KEYS = { all: ['recipients'] as const, one: (id: number) => ['recipients', id] as const };

export function useRecipients() {
  return useQuery({ queryKey: KEYS.all, queryFn: api.recipients.list });
}

export function useRecipient(id: number) {
  return useQuery({ queryKey: KEYS.one(id), queryFn: () => api.recipients.get(id), enabled: Number.isFinite(id) });
}

export function useRecipientMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: KEYS.all });
    qc.invalidateQueries({ queryKey: ['chats'] });
  };
  return {
    create: useMutation({ mutationFn: (v: CreateRecipientInput) => api.recipients.create(v), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: number; input: UpdateRecipientInput }) => api.recipients.update(v.id, v.input), onSuccess: done }),
    setEnabled: useMutation({ mutationFn: (v: { id: number; enabled: boolean }) => api.recipients.setEnabled(v.id, v.enabled), onSuccess: done }),
    issueCode: useMutation({ mutationFn: (v: { id: number; channel: Channel }) => api.recipients.issueCode(v.id, v.channel) }),
    resetBinding: useMutation({ mutationFn: (v: { id: number; channel: Channel }) => api.recipients.resetBinding(v.id, v.channel), onSuccess: done }),
    sendMenu: useMutation({
      mutationFn: (v: { id: number; channel: Channel }) => api.recipients.sendMenu(v.id, v.channel),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['deliveries'] }),
    }),
    sendMenuAll: useMutation({
      mutationFn: (channel: Channel) => api.recipients.sendMenuAll(channel),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['deliveries'] }),
    }),
    remove: useMutation({ mutationFn: (id: number) => api.recipients.remove(id), onSuccess: done }),
    setSubscriptions: useMutation({
      mutationFn: (v: { id: number; kind: 'summary' | 'alert'; chatIds: number[] }) => api.recipients.setSubscriptions(v.id, v.kind, v.chatIds),
      onSuccess: done,
    }),
  };
}
