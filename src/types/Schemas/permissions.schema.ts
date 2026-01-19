import { z } from 'zod';
import { PermissionParamsResponse } from '../Interfaces/IPermissions';
import { ErrorSchema } from './error.schema';

export const PermissionsSchema = {
	description: 'Get the permissions structure by role',
	params: z.object({
		role: z.string(),
	}),
	response: {
		200: PermissionParamsResponse,
		500: ErrorSchema,
	},
	tags: ['Permissions'],
};
