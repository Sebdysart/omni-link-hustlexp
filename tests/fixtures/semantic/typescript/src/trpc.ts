import { USER_LIMIT, createUser } from './shared.js';

const router = {
  query: (..._args: unknown[]): undefined => undefined,
  mutation: (..._args: unknown[]): undefined => undefined,
};

router.query('users.list', () => USER_LIMIT);
router.mutation('users.create', () => createUser({ name: 'Grace', email: 'grace@example.com' }));
