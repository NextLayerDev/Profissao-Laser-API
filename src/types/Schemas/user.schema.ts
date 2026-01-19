import z from 'zod';
import {
	UpdateUserParamsSchema,
	UserParamsSchema,
} from '../Interfaces/IUserParams';
import { ErrorSchema } from './error.schema';

export const UserSchema = {
	description: 'Get the users',
	response: {
		200: z.array(UserParamsSchema),
		401: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['User'],
};

export const UpdateUserSchema = {
	description: 'Update user',
	params: z.object({
		id: z.string(),
	}),
	body: UpdateUserParamsSchema,
	response: {
		200: z.any(),
		401: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['User'],
};
