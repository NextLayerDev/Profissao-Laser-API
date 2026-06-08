import { z } from 'zod';

export const LASER_LINE_TYPE_SOFTWARES = [
	'Ezcad',
	'Lightburn',
	'LaserGRBL',
] as const;
export type LaserLineTypeSoftware = (typeof LASER_LINE_TYPE_SOFTWARES)[number];

export const laserLineTypeSchema = z.object({
	id: z.string(),
	software: z.enum(LASER_LINE_TYPE_SOFTWARES),
	name: z.string(),
	imageUrl: z.string().nullable(),
	order: z.number().int(),
	createdAt: z.string(),
});

/** Body para POST /laser-line-types (multipart). Imagem vem como file. */
export const createLaserLineTypeFieldsSchema = z.object({
	software: z.enum(LASER_LINE_TYPE_SOFTWARES),
	name: z.string().min(1),
	order: z.coerce.number().int().min(0).default(0),
});

export const updateLaserLineTypeSchema = z.object({
	software: z.enum(LASER_LINE_TYPE_SOFTWARES).optional(),
	name: z.string().min(1).optional(),
	order: z.number().int().min(0).optional(),
});

export const listLaserLineTypesQuerySchema = z.object({
	software: z.enum(LASER_LINE_TYPE_SOFTWARES).optional(),
});

export type LaserLineType = z.infer<typeof laserLineTypeSchema>;
export type CreateLaserLineTypeFields = z.infer<
	typeof createLaserLineTypeFieldsSchema
>;
export type UpdateLaserLineType = z.infer<typeof updateLaserLineTypeSchema>;
