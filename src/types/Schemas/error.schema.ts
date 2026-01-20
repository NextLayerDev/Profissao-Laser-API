import { z } from 'zod';

export const ErrorSchema = z.object({
	message: z.string(),
	code: z.string().optional(),
	issues: z.array(z.object({ message: z.string() })).optional(),
});
