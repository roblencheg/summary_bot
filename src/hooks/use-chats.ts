import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { ChatRulesDto } from '~shared/schemas';

const KEYS = {
  all: ['chats'] as const,
  one: (id: number) => ['chats', id] as const,
  messages: (id: number, offset: number) => ['chats', id, 'messages', offset] as const,
};

export function useChats() {
  return useQuery({ queryKey: KEYS.all, queryFn: api.chats.list });
}

export function useChat(id: number) {
  return useQuery({ queryKey: KEYS.one(id), queryFn: () => api.chats.get(id), enabled: Number.isFinite(id) });
}

export function useChatMessages(id: number, offset: number) {
  return useQuery({ queryKey: KEYS.messages(id, offset), queryFn: () => api.chats.messages(id, offset), enabled: Number.isFinite(id) });
}

export function useMessage(id: number | null) {
  return useQuery({ queryKey: ['message', id], queryFn: () => api.messages.get(id!), enabled: id !== null });
}

export function useFailedMessages() {
  return useQuery({ queryKey: ['messages', 'failed'], queryFn: api.messages.failed });
}

export function useChatMutations(id: number) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: KEYS.all });
  return {
    activate: useMutation({ mutationFn: () => api.chats.activate(id), onSuccess: done }),
    deactivate: useMutation({ mutationFn: () => api.chats.deactivate(id), onSuccess: done }),
    checkRights: useMutation({ mutationFn: () => api.chats.checkRights(id), onSuccess: done }),
    setStaff: useMutation({
      mutationFn: (staff: Array<{ telegramUserId: number; label: string | null }>) => api.chats.setStaff(id, staff),
      onSuccess: done,
    }),
    setRules: useMutation({ mutationFn: (rules: Partial<ChatRulesDto>) => api.chats.setRules(id, rules), onSuccess: done }),
  };
}

export function useRequeue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: number | null) => api.messages.requeue(chatId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', 'failed'] }),
  });
}
