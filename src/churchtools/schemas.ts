import { z } from 'zod';

const id = z.number().int().positive();
export const identitySchema = z.object({ id });
export const apiGroupSchema = z.object({ id, name: z.string(), information: z.record(z.string(), z.unknown()) }).passthrough();
export const apiPersonSchema = z.object({ id, firstName: z.string(), lastName: z.string(),
  emails: z.array(z.object({ email: z.string() }).passthrough()).nullish(),
  imageUrl: z.string().nullish(), mobile: z.string().nullish(), phonePrivate: z.string().nullish(), phoneWork: z.string().nullish(),
  website_responsibilities: z.string().nullish(),
}).passthrough();
const masterEntry = z.object({ id }).passthrough();
export const masterDataSchema = z.object({
  groupCategories: z.array(masterEntry), targetGroups: z.array(masterEntry),
}).passthrough();
export const pageSchema = z.object({ data: z.array(z.unknown()),
  meta: z.object({ pagination: z.object({ current: z.number().int().positive().optional(), lastPage: z.number().int().nonnegative() }) }),
});
export type ApiGroup = z.infer<typeof apiGroupSchema>;
export type ApiPerson = z.infer<typeof apiPersonSchema>;
export type MasterData = z.infer<typeof masterDataSchema>;
