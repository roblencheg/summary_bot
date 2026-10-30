import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/api';

export function useOverview(hours: number) {
  return useQuery({ queryKey: ['overview', hours], queryFn: () => api.overview(hours), refetchInterval: 30_000 });
}
