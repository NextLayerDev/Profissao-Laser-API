import { z } from 'zod';
import { classSchema } from './class.js';
import { productSchema } from './product.js';

export const systemClassSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	status: z.enum(['ativo', 'inativo']),
	aula: z.boolean(),
	chat: z.boolean(),
	vetorizacao: z.boolean(),
	suporte: z.boolean(),
	comunidade: z.boolean(),
	system: z.boolean(),
	prata: z.boolean(),
	gold: z.boolean(),
	platina: z.boolean(),
	dashboard: z.boolean(),
	gestaoEstoque: z.boolean(),
	estoquePorLoja: z.boolean(),
	vendasPedidos: z.boolean(),
	gestaoPerdas: z.boolean(),
	gestaoCustos: z.boolean(),
	financeiro: z.boolean(),
	relatorios: z.boolean(),
	controleSistema: z.boolean(),
	gerenciamentoSistema: z.boolean(),
	nfesEmitidas: z.boolean(),
	driveImagens: z.boolean(),
	profissaoLaser: z.boolean(),
	avancados: z.boolean(),
	planoOuroPlatina: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const systemClassWithRelationsSchema = systemClassSchema.extend({
	products: z.array(productSchema),
	classes: z.array(classSchema),
});

export const createSystemClassSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).default('ativo'),
	aula: z.boolean().default(false),
	chat: z.boolean().default(false),
	vetorizacao: z.boolean().default(false),
	suporte: z.boolean().default(false),
	comunidade: z.boolean().default(false),
	system: z.boolean().default(false),
	prata: z.boolean().default(false),
	gold: z.boolean().default(false),
	platina: z.boolean().default(false),
	dashboard: z.boolean().default(false),
	gestaoEstoque: z.boolean().default(false),
	estoquePorLoja: z.boolean().default(false),
	vendasPedidos: z.boolean().default(false),
	gestaoPerdas: z.boolean().default(false),
	gestaoCustos: z.boolean().default(false),
	financeiro: z.boolean().default(false),
	relatorios: z.boolean().default(false),
	controleSistema: z.boolean().default(false),
	gerenciamentoSistema: z.boolean().default(false),
	nfesEmitidas: z.boolean().default(false),
	driveImagens: z.boolean().default(false),
	profissaoLaser: z.boolean().default(false),
	avancados: z.boolean().default(false),
	planoOuroPlatina: z.boolean().default(false),
});

export const updateSystemClassSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
	aula: z.boolean().optional(),
	chat: z.boolean().optional(),
	vetorizacao: z.boolean().optional(),
	suporte: z.boolean().optional(),
	comunidade: z.boolean().optional(),
	system: z.boolean().optional(),
	prata: z.boolean().optional(),
	gold: z.boolean().optional(),
	platina: z.boolean().optional(),
	dashboard: z.boolean().optional(),
	gestaoEstoque: z.boolean().optional(),
	estoquePorLoja: z.boolean().optional(),
	vendasPedidos: z.boolean().optional(),
	gestaoPerdas: z.boolean().optional(),
	gestaoCustos: z.boolean().optional(),
	financeiro: z.boolean().optional(),
	relatorios: z.boolean().optional(),
	controleSistema: z.boolean().optional(),
	gerenciamentoSistema: z.boolean().optional(),
	nfesEmitidas: z.boolean().optional(),
	driveImagens: z.boolean().optional(),
	profissaoLaser: z.boolean().optional(),
	avancados: z.boolean().optional(),
	planoOuroPlatina: z.boolean().optional(),
});

export const addProductToSystemClassSchema = z.object({
	productId: z.string(),
});

export const addClassToSystemClassSchema = z.object({
	classId: z.string(),
});

export type SystemClassCreate = z.infer<typeof createSystemClassSchema>;
export type SystemClassUpdate = z.infer<typeof updateSystemClassSchema>;
