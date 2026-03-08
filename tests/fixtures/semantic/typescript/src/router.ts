import {
  createUser,
  USER_LIMIT,
  type AuditRecord,
  type UserInput,
  type UserResult,
} from './shared.js';

const app = {
  get: (..._args: unknown[]): undefined => undefined,
  post: (..._args: unknown[]): undefined => undefined,
};

app.get('/api/users', () => USER_LIMIT);
app.post('/api/users', (_req: unknown) => createUser({ name: 'Ada', email: 'ada@example.com' }));

export function getAudit(input: AuditRecord): UserResult {
  return createUser(input);
}

export type RouterPayload = UserInput;
