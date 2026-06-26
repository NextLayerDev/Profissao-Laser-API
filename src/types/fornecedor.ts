import { z } from 'zod';

/**
 * Fornecedor = entidade real da tool "Fornecedores" (substitui a gambiarra que
 * lia mensagens do canal da comunidade). `content` guarda o markdown verbatim
 * (🏢 Empresa / 📞 Contato / 🛒 Produtos…), preservado da migração.
 */
export const fornecedorSchema = z.object({
	id: z.string(),
	company: z.string(),
	content: z.string(),
	imageUrl: z.string().nullable(),
	authorName: z.string().nullable(),
	authorAvatar: z.string().nullable(),
	isActive: z.boolean(),
	order: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Fornecedor = z.infer<typeof fornecedorSchema>;

export const createFornecedorSchema = z.object({
	company: z.string().min(1),
	content: z.string().min(1),
	imageUrl: z.string().nullish(),
	authorName: z.string().nullish(),
	authorAvatar: z.string().nullish(),
	isActive: z.boolean().optional(),
	order: z.number().int().optional(),
});
export type CreateFornecedor = z.infer<typeof createFornecedorSchema>;

export const updateFornecedorSchema = createFornecedorSchema.partial();
export type UpdateFornecedor = z.infer<typeof updateFornecedorSchema>;
