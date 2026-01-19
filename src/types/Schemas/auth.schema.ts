import { z } from 'zod';
import {
	LoginParamsSchema,
	RegisterParamsSchema,
} from '../Interfaces/IAuthParams';
import { ErrorSchema } from './error.schema';

export const LoginSchema = {
	description: 'Login with token return',
	body: LoginParamsSchema,
	response: {
		200: z.object({
			token: z.string(),
		}),
		401: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['Auth'],
};

export const RegisterSchema = {
	description: 'Register a new user',
	body: RegisterParamsSchema,
	response: {
		201: z.object({
			message: z.string(),
			user: z.any().optional(),
		}),
		400: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['Auth'],
};
