import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import type { LoginInput } from '~shared/schemas';

export const AUTH_KEY = ['auth'] as const;

export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: api.auth.status, staleTime: 60_000 });
}

/** Текущий пользователь (роль и дирекции); роль определяет навигацию и доступные действия. */
export function useMe() {
  const me = useAuthStatus().data?.admin ?? null;
  return { me, isSuper: me?.role === 'superadmin' };
}

// Ставится при успешном первом входе, читается один раз и сбрасывается — показать ролик сразу после входа.
let firstLoginFlag = false;
export function consumeFirstLoginFlag(): boolean {
  const v = firstLoginFlag;
  firstLoginFlag = false;
  return v;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (data) => {
      firstLoginFlag = data.firstLogin;
      qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: AUTH_KEY });
    },
  });
}

export function useAdmins() {
  return useQuery({ queryKey: ['admins'], queryFn: api.admins.list });
}

export function useAdminMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['admins'] });
  return {
    create: useMutation({ mutationFn: (v: { login: string; password: string }) => api.admins.create(v.login, v.password), onSuccess: done }),
    password: useMutation({ mutationFn: (v: { id: number; password: string }) => api.admins.password(v.id, v.password), onSuccess: done }),
    setDisabled: useMutation({ mutationFn: (v: { id: number; disabled: boolean }) => api.admins.setDisabled(v.id, v.disabled), onSuccess: done }),
  };
}
