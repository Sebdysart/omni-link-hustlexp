export const router = <T extends Record<string, unknown>>(shape: T): T => shape;
export const publicProcedure = {
  query: <T>(resolver: T): T => resolver,
  mutation: <T>(resolver: T): T => resolver,
};
