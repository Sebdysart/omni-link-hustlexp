export interface UserInput {
  name: string;
  email: string;
}

export interface AuditRecord extends UserInput {
  id: string;
}

export type UserResult = Promise<{
  id: string;
  email: string;
}>;

export const USER_LIMIT = 10;

export function createUser(input: UserInput): UserResult {
  return Promise.resolve({
    id: input.email,
    email: input.email,
  });
}
