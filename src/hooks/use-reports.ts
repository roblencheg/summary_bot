import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { ManualReportInput } from '~shared/schemas';

export function useReports(f: { recipientId?: number; periodId?: number; offset?: number }) {
  return useQuery({ queryKey: ['reports', f], queryFn: () => api.reports.list({ ...f, limit: 50 }) });
}

export function useReport(id: number | null) {
  return useQuery({ queryKey: ['report', id], queryFn: () => api.reports.get(id!), enabled: id !== null });
}

export function usePeriods(enabled = true) {
  return useQuery({ queryKey: ['periods'], queryFn: api.reports.periods, enabled });
}

export function useReportMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['periods'] });
  };
  return {
    manual: useMutation({ mutationFn: (v: ManualReportInput) => api.reports.manual(v), onSuccess: done }),
    rebuild: useMutation({ mutationFn: (periodId: number) => api.reports.rebuild(periodId), onSuccess: done }),
  };
}
