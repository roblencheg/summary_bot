import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/api';

export function useAudit(f: { entity?: string; actor?: string; offset: number }) {
  return useQuery({ queryKey: ['audit', f], queryFn: () => api.audit({ ...f, limit: 50 }) });
}
