// Every data access goes through a Scope. It is built server-side from the session (never from the
// client), and every query filters on scope.clientId.
export type Role = 'owner' | 'rep' | 'client';
export type Scope = {
  clientId: number;
  userId: number | null;
  role: Role;
  agency: boolean;
};

/** Single-user mode: no login, one workspace. */
export const SINGLE_USER: Scope = Object.freeze({ clientId: 1, userId: null, role: 'owner', agency: false });

export class ForbiddenError extends Error {}

export function assertCanWrite(s: Scope) {
  if (s.role === 'client') throw new ForbiddenError('Client accounts are read-only.');
}
