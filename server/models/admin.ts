export type AdminRole = 'superadmin' | 'manager';

export interface Admin {
  id: number;
  login: string;
  role: AdminRole;
  passwordHash: string;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminSession {
  tokenHash: string;
  adminId: number;
  createdAt: string;
  expiresAt: string;
}
