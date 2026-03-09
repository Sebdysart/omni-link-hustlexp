import { router, publicProcedure } from '../trpc';

export const taskRouter = router({
  create: publicProcedure.mutation(() => ({ ok: true })),
});
