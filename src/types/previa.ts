import { z } from 'zod';

// ─── LaserSettings ────────────────────────────────────────────────────────
// Espelha exatamente o LaserSettings de
// system_porteira/src/components/ia-previsoes.tsx (linhas 109–140).

export const laserSettingsSchema = z.object({
	tamanho: z.string(),
	posicao: z.string(),
	rotacao: z.number(),
	intensidade: z.string(),
	profundidade: z.string(),
	comNome: z.string(),
	nomePersonalizado: z.string(),
	fonteFamilia: z.string(),
	tamanhoNome: z.string(),
	orientacaoLogo: z.string(),
	orientacaoNome: z.string(),
	material: z.string(),
	estiloGravacao: z.string(),
	acabamentoSuperficie: z.string(),
	contraste: z.number(),
	efeitoSombra: z.number(),
	moldura: z.string(),
	posicaoTextoRelLogo: z.string(),
	espacamentoLogoTexto: z.string(),
	tipoVisualizacao: z.string(),
	anguloCamera: z.string(),
	iluminacao: z.string(),
	fundoCena: z.string(),
	apenasTexto: z.boolean(),
	modoLentes: z.boolean(),
	textoLenteDireita: z.string(),
	textoLenteEsquerda: z.string(),
});

export type LaserSettings = z.infer<typeof laserSettingsSchema>;

// ─── Generate (request body) ──────────────────────────────────────────────
// Body simplificado: customer só seleciona productVariantId (catálogo
// gerenciado por admin em /laser-products) e envia opcionalmente a própria
// logo. Não aceita mais imagebase_url nem imageproduct_url no payload.

export const generatePreviaSchema = z.object({
	// OBRIGATÓRIO — referencia o variant do catálogo (pl_laser_product_variant)
	productVariantId: z.uuid(),

	// Logo do customer (URL ou data:image/...;base64,...).
	// Obrigatória quando personalizationType !== 'text'.
	imagelogo_url: z.string().nullable().optional(),

	laserSettings: laserSettingsSchema,
	personalizationType: z.enum(['logo', 'text', 'both']),
	customName: z.string().nullable().optional(),
	instrucoesPersonalizadas: z.string().nullable().optional(),
	textoLenteDireita: z.string().nullable().optional(),
	textoLenteEsquerda: z.string().nullable().optional(),
	modoLentes: z.boolean().optional(),
	// Marca d'água: se true, aplica a logo salva em /watermark nos cantos
	// inferior-esquerdo e superior-direito da imagem final. Erro 400 se
	// `true` e o customer não tem watermark cadastrada.
	useWatermark: z.boolean().optional(),
	name: z.string().optional(),
	notes: z.string().optional(),
});

export type GeneratePreviaInput = z.infer<typeof generatePreviaSchema>;

// ─── Previa (response/entity) ─────────────────────────────────────────────

export const previaSchema = z.object({
	id: z.uuid(),
	customerId: z.string(),
	name: z.string(),
	productName: z.string(),
	productColor: z.string().nullable(),
	imagebaseUrl: z.string(),
	imageproductUrl: z.string(),
	imagelogoUrl: z.string().nullable(),
	previewUrl: z.string(),
	personalizationType: z.enum(['logo', 'text', 'both']),
	customName: z.string().nullable(),
	instrucoesPersonalizadas: z.string().nullable(),
	textoLenteDireita: z.string().nullable(),
	textoLenteEsquerda: z.string().nullable(),
	modoLentes: z.boolean(),
	laserSettings: laserSettingsSchema,
	notes: z.string().nullable(),
	prompt: z.string().nullable(),
	aiModel: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Previa = z.infer<typeof previaSchema>;

// ─── Update (PUT body) ────────────────────────────────────────────────────

export const updatePreviaSchema = z.object({
	name: z.string().optional(),
	notes: z.string().optional(),
});

export type UpdatePreviaInput = z.infer<typeof updatePreviaSchema>;

// ─── History (paginated response) ─────────────────────────────────────────

export const previaHistoryQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const previaHistoryResponseSchema = z.object({
	data: z.array(previaSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});

// ─── Quota (limite diário) ────────────────────────────────────────────────

export const previaQuotaSchema = z.object({
	limit: z.number(),
	used: z.number(),
	remaining: z.number(),
	resetsAt: z.string(),
});

export const previaQuotaErrorSchema = z.object({
	message: z.string(),
	code: z.literal('DAILY_LIMIT_REACHED'),
	limit: z.number(),
	used: z.number(),
	remaining: z.number(),
	resetsAt: z.string(),
});
