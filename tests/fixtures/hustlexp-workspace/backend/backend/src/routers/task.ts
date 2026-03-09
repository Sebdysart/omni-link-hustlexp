import { z } from 'zod';
import { router, publicProcedure } from '../trpc';

export const taskRouter = router({
  create: publicProcedure
    .input(
      z.object({
        title: z.string(),
        price: z.number(),
      }),
    )
    .mutation(() => ({ id: 'task_1', state: 'OPEN' })),
});
