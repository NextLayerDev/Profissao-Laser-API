import z from 'zod';
import {
	CustomerParamsSchema,
	UpdateCustomerParamsSchema,
} from '../Interfaces/ICustomers';
import { ErrorSchema } from './error.schema';

export const CustomerSchema = {
	description: 'Get the customers',
	response: {
		200: z.array(CustomerParamsSchema),
		401: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['Customers'],
};

export const UpdateCustomerSchema = {
	description: 'Update customer',
	params: z.object({
		id: z.string(),
	}),
	body: UpdateCustomerParamsSchema,
	response: {
		200: z.any(),
		401: ErrorSchema,
		500: ErrorSchema,
	},
	tags: ['Customers'],
};
