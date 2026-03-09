import { router } from '../trpc';
import { messagingRouter } from './messaging';
import { taskRouter } from './task';

export const appRouter = router({
  task: taskRouter,
  messaging: messagingRouter,
});
