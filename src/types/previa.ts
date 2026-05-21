import { z } from 'zod';
import {
	FONT_VALUES,
	LASER_OPTIONS,
	LASER_RANGES,
	optionValues,
} from '../lib/previa-options.js';

// ─── LaserSettings (INPUT — validação estrita) ────────────────────────────
// Campos discretos viram z.enum() — valor fora da lista → 400.
// As listas de valores vêm de src/lib/previa-options.ts (fonte única).

export const laserSettingsSchema = z.object({
	tamanho: z.enum(optionValues(LASER_OPTIONS.tamanho)),
	posicao: z.enum(optionValues(LASER_OPTIONS.posicao)),
	rotacao: z
		.number()
		.int()
		.min(LASER_RANGES.rotacao.min)
		.max(LASER_RANGES.rotacao.max),
	intensidade: z.enum(optionValues(LASER_OPTIONS.intensidade)),
	profundidade: z.enum(optionValues(LASER_OPTIONS.profundidade)),
	comNome: z.enum(optionValues(LASER_OPTIONS.comNome)),
	nomePersonalizado: z.string(),
	fonteFamilia: z.enum(FONT_VALUES),
	tamanhoNome: z.enum(optionValues(LASER_OPTIONS.tamanhoNome)),
	orientacaoLogo: z.enum(optionValues(LASER_OPTIONS.orientacaoLogo)),
	orientacaoNome: z.enum(optionValues(LASER_OPTIONS.orientacaoNome)),
	material: z.enum(optionValues(LASER_OPTIONS.material)),
	estiloGravacao: z.enum(optionValues(LASER_OPTIONS.estiloGravacao)),
	acabamentoSuperficie: z.enum(
		optionValues(LASER_OPTIONS.acabamentoSuperficie),
	),
	contraste: z
		.number()
		.int()
		.min(LASER_RANGES.contraste.min)
		.max(LASER_RANGES.contraste.max),
	efeitoSombra: z
		.number()
		.int()
		.min(LASER_RANGES.efeitoSombra.min)
		.max(LASER_RANGES.efeitoSombra.max),
	moldura: z.enum(optionValues(LASER_OPTIONS.moldura)),
	posicaoTextoRelLogo: z.enum(optionValues(LASER_OPTIONS.posicaoTextoRelLogo)),
	espacamentoLogoTexto: z.enum(
		optionValues(LASER_OPTIONS.espacamentoLogoTexto),
	),
	tipoVisualizacao: z.enum(optionValues(LASER_OPTIONS.tipoVisualizacao)),
	anguloCamera: z.enum(optionValues(LASER_OPTIONS.anguloCamera)),
	iluminacao: z.enum(optionValues(LASER_OPTIONS.iluminacao)),
	fundoCena: z.enum(optionValues(LASER_OPTIONS.fundoCena)),
	apenasTexto: z.boolean(),
	modoLentes: z.boolean(),
	textoLenteDireita: z.string(),
	textoLenteEsquerda: z.string(),
});

export type LaserSettings = z.infer<typeof laserSettingsSchema>;

// ─── LaserSettings (RESPONSE — loose passthrough do JSONB) ────────────────
// Registros antigos em pl_previa.laserSettings podem ter valores fora dos
// enums novos; a resposta usa passthrough pra nunca quebrar serialização.
export const storedLaserSettingsSchema = z.record(z.string(), z.unknown());

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
	// Marca d'água: modo de aplicação no output.
	//   'none'    → não aplica (default).
	//   'corners' → 2 logos opacos nos cantos (BL + TR), comportamento atual.
	//   'tiled'   → grade de logozinhas low-opacity cobrindo a imagem inteira
	//               (proteção forte).
	// Erro 400 se !== 'none' e o customer não tem watermark cadastrada em
	// /watermark.
	watermarkMode: z.enum(['none', 'corners', 'tiled']).optional(),
	// DEPRECATED — usar `watermarkMode`. `useWatermark:true` é alias de
	// `watermarkMode:'corners'` pra compat com front antigo.
	useWatermark: z.boolean().optional(),
	name: z.string().optional(),
	notes: z.string().optional(),
	useCredits: z.boolean().optional().default(false),
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
	laserSettings: storedLaserSettingsSchema,
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

// ─── Options (GET /previas/options) ───────────────────────────────────────

const previaOptionItemSchema = z.object({
	value: z.string(),
	label: z.string(),
});

const previaFontOptionSchema = z.object({
	value: z.string(),
	label: z.string(),
	family: z.string(),
	category: z.string(),
});

const previaRangeSchema = z.object({
	min: z.number(),
	max: z.number(),
});

export const previaOptionsResponseSchema = z.object({
	tamanho: z.array(previaOptionItemSchema),
	posicao: z.array(previaOptionItemSchema),
	intensidade: z.array(previaOptionItemSchema),
	profundidade: z.array(previaOptionItemSchema),
	tamanhoNome: z.array(previaOptionItemSchema),
	material: z.array(previaOptionItemSchema),
	estiloGravacao: z.array(previaOptionItemSchema),
	acabamentoSuperficie: z.array(previaOptionItemSchema),
	moldura: z.array(previaOptionItemSchema),
	posicaoTextoRelLogo: z.array(previaOptionItemSchema),
	espacamentoLogoTexto: z.array(previaOptionItemSchema),
	tipoVisualizacao: z.array(previaOptionItemSchema),
	anguloCamera: z.array(previaOptionItemSchema),
	iluminacao: z.array(previaOptionItemSchema),
	fundoCena: z.array(previaOptionItemSchema),
	orientacaoLogo: z.array(previaOptionItemSchema),
	orientacaoNome: z.array(previaOptionItemSchema),
	comNome: z.array(previaOptionItemSchema),
	fontes: z.array(previaFontOptionSchema),
	ranges: z.object({
		rotacao: previaRangeSchema,
		contraste: previaRangeSchema,
		efeitoSombra: previaRangeSchema,
	}),
});

// ─── Admin: Usage stats (GET /previas/usage/*) ────────────────────────────

export const previaUsageStatsSchema = z.object({
	generatedToday: z.number(),
	activeUsersToday: z.number(),
	totalUsers: z.number(),
});

export const previaUsageUserSchema = z.object({
	customerId: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	totalPrevias: z.number(),
	todayPrevias: z.number(),
	lastGeneratedAt: z.string(),
});

export const previaUsageUsersQuerySchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
	search: z.string().optional(),
});

export const previaUsageUsersResponseSchema = z.object({
	data: z.array(previaUsageUserSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});
