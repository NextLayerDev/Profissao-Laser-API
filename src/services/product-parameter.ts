import crypto from 'node:crypto';
import { customerMachineRepository } from '../repositories/customer-machine.js';
import { lessonRepository } from '../repositories/lesson.js';
import { parameterRepository } from '../repositories/parameter.js';
import { productParameterRepository } from '../repositories/product-parameter.js';
import type {
	CreateProductParameterInput,
	ParameterLookupQuery,
	ProductParameter,
	UpdateProductParameterInput,
} from '../types/product-parameter.js';
import { machineService } from './machine.js';

const OPTION_COLS = [
	'powerOptionId',
	'lensOptionId',
	'softwareOptionId',
	'axisOptionId',
	'operationOptionId',
] as const;

type OptionCol = (typeof OPTION_COLS)[number];

// biome-ignore lint/suspicious/noExplicitAny: linha do pl_parameter (shape dinâmico)
type ParameterRow = any;
// biome-ignore lint/suspicious/noExplicitAny: linha do pl_lesson
type LessonRow = any;

class ProductParameterService {
	/** Enriquece uma associação com o parâmetro e a vídeo-aula. */
	private async enrich(assoc: ProductParameter): Promise<{
		association: ProductParameter;
		parameter: ParameterRow;
		lesson: LessonRow | null;
	}> {
		const parameter = await parameterRepository.findById(assoc.parameterId);
		let lesson: LessonRow | null = null;
		if (assoc.lessonId) {
			try {
				lesson = await lessonRepository.findById(assoc.lessonId);
			} catch {
				lesson = null;
			}
		}
		return { association: assoc, parameter, lesson };
	}

	async listByProduct(productId: string) {
		const assocs = await productParameterRepository.listByProduct(productId);
		const enriched = await Promise.all(assocs.map((a) => this.enrich(a)));
		return enriched.map((e) => ({
			...e.association,
			parameter: e.parameter,
			lesson: e.lesson,
		}));
	}

	async create(
		productId: string,
		data: CreateProductParameterInput,
		adminUserId: string | null,
	): Promise<ProductParameter> {
		// 1. Valida máquina + opções
		await machineService.validateConfig(data.machineId, {
			power: data.powerOptionId,
			lens: data.lensOptionId,
			software: data.softwareOptionId,
			axis: data.axisOptionId,
			operation: data.operationOptionId,
		});

		// 2. Resolve parâmetro: existente ou criar novo inline
		let parameterId = data.parameterId ?? null;
		if (data.parameter) {
			const created = await parameterRepository.create(
				data.parameter,
				adminUserId ?? 'system',
				null,
			);
			parameterId = created.id;
		} else if (parameterId) {
			// garante que o parâmetro existe
			await parameterRepository.findById(parameterId);
		}
		if (!parameterId) {
			throw new Error('Informe parameterId OU parameter (exatamente um)');
		}

		// 3. Valida vídeo-aula (se fornecida)
		if (data.lessonId) {
			await lessonRepository.findById(data.lessonId);
		}

		// 4. Cria a associação
		return productParameterRepository.create({
			id: crypto.randomUUID(),
			productId,
			machineId: data.machineId,
			parameterId,
			powerOptionId: data.powerOptionId ?? null,
			lensOptionId: data.lensOptionId ?? null,
			softwareOptionId: data.softwareOptionId ?? null,
			axisOptionId: data.axisOptionId ?? null,
			operationOptionId: data.operationOptionId ?? null,
			lessonId: data.lessonId ?? null,
		});
	}

	async update(
		productId: string,
		id: string,
		data: UpdateProductParameterInput,
	): Promise<ProductParameter> {
		const current = await productParameterRepository.findByIdAndProduct(
			id,
			productId,
		);
		const machineId = data.machineId ?? current.machineId;
		// Revalida config se mexeu em máquina ou em alguma opção
		await machineService.validateConfig(machineId, {
			power:
				data.powerOptionId !== undefined
					? data.powerOptionId
					: current.powerOptionId,
			lens:
				data.lensOptionId !== undefined
					? data.lensOptionId
					: current.lensOptionId,
			software:
				data.softwareOptionId !== undefined
					? data.softwareOptionId
					: current.softwareOptionId,
			axis:
				data.axisOptionId !== undefined
					? data.axisOptionId
					: current.axisOptionId,
			operation:
				data.operationOptionId !== undefined
					? data.operationOptionId
					: current.operationOptionId,
		});
		if (data.lessonId) await lessonRepository.findById(data.lessonId);
		if (data.parameterId) await parameterRepository.findById(data.parameterId);
		return productParameterRepository.update(id, productId, data);
	}

	async delete(productId: string, id: string): Promise<void> {
		return productParameterRepository.delete(id, productId);
	}

	/**
	 * Retorna o parâmetro mais específico que casa com (produto + máquina +
	 * config do cliente) + a vídeo-aula. Usa a máquina salva do customer se
	 * `query.machineId` não vier.
	 */
	async lookup(
		productId: string,
		customerId: string,
		query: ParameterLookupQuery,
	) {
		// Resolve config: query > máquina salva
		let config: Record<OptionCol | 'machineId', string | null> = {
			machineId: query.machineId ?? null,
			powerOptionId: query.powerOptionId ?? null,
			lensOptionId: query.lensOptionId ?? null,
			softwareOptionId: query.softwareOptionId ?? null,
			axisOptionId: query.axisOptionId ?? null,
			operationOptionId: query.operationOptionId ?? null,
		};
		if (!config.machineId) {
			const saved =
				await customerMachineRepository.findByCustomerId(customerId);
			if (!saved) throw new Error('Máquina não informada');
			config = {
				machineId: saved.machineId,
				powerOptionId: saved.powerOptionId,
				lensOptionId: saved.lensOptionId,
				softwareOptionId: saved.softwareOptionId,
				axisOptionId: saved.axisOptionId,
				operationOptionId: saved.operationOptionId,
			};
		}

		const assocs = await productParameterRepository.listByProductAndMachine(
			productId,
			config.machineId as string,
		);

		// Filtra: cada coluna de opção não-nula da associação tem que bater
		const matches = assocs.filter((a) =>
			OPTION_COLS.every((col) => a[col] === null || a[col] === config[col]),
		);
		if (matches.length === 0) {
			throw new Error('Parâmetro não encontrado');
		}

		// Mais específico = mais colunas de opção preenchidas; empate → recente
		matches.sort((a, b) => {
			const sa = OPTION_COLS.filter((c) => a[c] !== null).length;
			const sb = OPTION_COLS.filter((c) => b[c] !== null).length;
			if (sb !== sa) return sb - sa;
			return b.createdAt.localeCompare(a.createdAt);
		});

		return this.enrich(matches[0]);
	}
}

export const productParameterService = new ProductParameterService();
