import { z } from 'zod';
import { router, publicProcedure } from '../trpc';

export const messagingRouter = router({
  sendMessage: publicProcedure
    .input(
      z.object({
        conversationId: z.string(),
        body: z.string(),
      }),
    )
    .mutation(() => ({ id: 'msg_1', delivered: true })),
});
