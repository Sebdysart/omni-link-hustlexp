import { router, publicProcedure } from '../trpc';

export const messagingRouter = router({
  sendMessage: publicProcedure.mutation(() => ({ delivered: true })),
});
