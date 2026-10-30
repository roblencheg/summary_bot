import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type IncidentFilters } from '~/lib/api';
import type { IncidentStatus } from '~shared/domain';

export function useIncidents(f: IncidentFilters) {
  return useQuery({ queryKey: ['incidents', f], queryFn: () => api.incidents.list(f), refetchInterval: 30_000 });
}

export function useIncident(id: number) {
  return useQuery({ queryKey: ['incident', id], queryFn: () => api.incidents.get(id), enabled: Number.isFinite(id) });
}

export function useSetIncidentStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: IncidentStatus) => api.incidents.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident', id] });
      qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}
