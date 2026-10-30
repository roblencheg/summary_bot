import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DeliveryFilters } from '~/lib/api';
import type { Channel } from '~shared/domain';

export function useDeliveries(f: DeliveryFilters) {
  return useQuery({ queryKey: ['deliveries', f], queryFn: () => api.deliveries.list(f), refetchInterval: 15_000 });
}

export function useDelivery(id: number | null) {
  return useQuery({ queryKey: ['delivery', id], queryFn: () => api.deliveries.get(id!), enabled: id !== null });
}

export function useDeliveryMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['deliveries'] });
  return {
    retry: useMutation({ mutationFn: (id: number) => api.deliveries.retry(id), onSuccess: done }),
    test: useMutation({ mutationFn: (v: { recipientId: number; channel: Channel }) => api.deliveries.test(v.recipientId, v.channel), onSuccess: done }),
  };
}
