import { blockRegistry } from '../tool-blocks/index.js';
import type { ToolDefinitionDoc } from './tool-definitions.js';

/**
 * Validação ESTRUTURAL pura de uma ToolDefinition (sem `block.run`, sem buffers):
 * espelha as barreiras do motor (`tool-engine.ts`) mas ACUMULA os erros em vez de
 * lançar no 1º. Usada pelo tool `validate` do Agente e como 2ª barreira (registry
 * REAL) contra divergência entre o catálogo do front e os blocos deployados.
 *
 * Checa: ids válidos + únicos; pipeline 1..32; cada `block` existe no registry;
 * refs (`<nó>.campo`) apontam pra `input` ou um nó ANTERIOR (ordem linear); saídas
 * apontam pra nós existentes. NÃO valida os params contra o zod do bloco (isso
 * exige valores resolvidos em runtime) — a checagem de tipo fica no agente (via
 * catálogo) e o motor revalida a fundo no run.
 */

const NODE_ID_RE = /^[a-zA-Z_]\w*$/;
const MAX_PIPELINE_NODES = 32;

export interface ValidationIssue {
	node?: string;
	field?: string;
	message: string;
}
export interface ValidationResult {
	valid: boolean;
	errors: ValidationIssue[];
}

/** Cabeça de uma ref (`!a.b` → `a`); null se for literal (sem ponto). */
function refHead(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const path = v.startsWith('!') ? v.slice(1) : v;
	const dot = path.indexOf('.');
	if (dot <= 0) return null;
	return path.slice(0, dot);
}

/** Validação de uma tool de sala (Mentoria): valida `room` em vez de pipeline. */
function validateRoomDefinition(doc: ToolDefinitionDoc): ValidationResult {
	const errors: ValidationIssue[] = [];
	const room = doc.room ?? {};
	if (room.cap != null && (!Number.isInteger(room.cap) || room.cap < 1)) {
		errors.push({
			field: 'room.cap',
			message: 'Capacidade deve ser inteiro ≥ 1 (ou vazio = sem limite).',
		});
	}
	const vox = room.access?.voxCost;
	if (vox != null && (typeof vox !== 'number' || vox < 0)) {
		errors.push({
			field: 'room.access.voxCost',
			message: 'Custo em voxes deve ser um número ≥ 0.',
		});
	}
	const opens = room.schedule?.opensMinutesBefore;
	if (opens != null && (!Number.isInteger(opens) || opens < 0 || opens > 120)) {
		errors.push({
			field: 'room.schedule.opensMinutesBefore',
			message: 'A sala abre entre 0 e 120 minutos antes (inteiro).',
		});
	}
	const dur = room.schedule?.defaultDurationMin;
	if (dur != null && (!Number.isInteger(dur) || dur < 1 || dur > 1440)) {
		errors.push({
			field: 'room.schedule.defaultDurationMin',
			message: 'Duração padrão deve ser um inteiro entre 1 e 1440 minutos.',
		});
	}
	if (room.link?.mode && room.link.mode !== 'external') {
		errors.push({
			field: 'room.link.mode',
			message: 'Só link externo (Zoom/Meet) é suportado.',
		});
	}
	// Aparência (room.ui) — valida cor/tema/banner de cada tela.
	for (const key of ['customer', 'admin'] as const) {
		const screen = room.ui?.[key];
		if (!screen) continue;
		if (screen.accent && !/^#[0-9a-fA-F]{6}$/.test(screen.accent)) {
			errors.push({
				field: `room.ui.${key}.accent`,
				message: 'A cor de destaque deve ser hex (#RRGGBB).',
			});
		}
		if (screen.theme && !['app', 'light', 'dark'].includes(screen.theme)) {
			errors.push({
				field: `room.ui.${key}.theme`,
				message: 'Tema deve ser app, light ou dark.',
			});
		}
		const nt = screen.notice?.type;
		if (nt && !['info', 'warning', 'success'].includes(nt)) {
			errors.push({
				field: `room.ui.${key}.notice.type`,
				message: 'Tipo do aviso deve ser info, warning ou success.',
			});
		}
	}
	return { valid: errors.length === 0, errors };
}

export function validateDefinition(doc: ToolDefinitionDoc): ValidationResult {
	// Tool de sala (Mentoria) tem `room` e não tem pipeline — valida o room.
	if (doc.room) return validateRoomDefinition(doc);

	const errors: ValidationIssue[] = [];
	const pipeline = doc.pipeline ?? [];

	if (pipeline.length === 0) {
		errors.push({ message: 'Pipeline vazio — adicione ao menos um bloco.' });
	}
	if (pipeline.length > MAX_PIPELINE_NODES) {
		errors.push({
			message: `Pipeline grande demais (${pipeline.length} > ${MAX_PIPELINE_NODES} blocos).`,
		});
	}

	const order = new Map<string, number>();
	const seen = new Set<string>();
	pipeline.forEach((node, i) => {
		if (!NODE_ID_RE.test(node.id)) {
			errors.push({
				node: node.id,
				message: `Id de nó inválido: '${node.id}'.`,
			});
		}
		if (seen.has(node.id)) {
			errors.push({
				node: node.id,
				message: `Id de nó duplicado: '${node.id}'.`,
			});
		}
		seen.add(node.id);
		order.set(node.id, i);
	});

	const isHead = (h: string) => h === 'input' || order.has(h);

	pipeline.forEach((node, i) => {
		if (!blockRegistry.get(node.block)) {
			errors.push({
				node: node.id,
				message: `Bloco desconhecido: '${node.block}'.`,
			});
		}
		for (const [field, value] of Object.entries(node.params ?? {})) {
			const head = refHead(value);
			if (!head || !isHead(head)) continue; // literal ou cabeça não-ref
			if (head !== 'input') {
				const srcIdx = order.get(head);
				if (srcIdx === undefined || srcIdx >= i) {
					errors.push({
						node: node.id,
						field,
						message: `Ligue a uma etapa ANTERIOR (a fonte '${head}' vem depois ou não existe).`,
					});
				}
			}
		}
	});

	const out = (doc.output ?? {}) as Record<string, unknown>;
	const checkOut = (v: unknown, key: string) => {
		const head = refHead(v);
		if (head && head !== 'input' && !order.has(head)) {
			errors.push({
				field: `output.${key}`,
				message: `A saída '${key}' aponta pra um nó inexistente ('${head}').`,
			});
		}
	};
	for (const [k, v] of Object.entries(out)) {
		if (Array.isArray(v)) for (const item of v) checkOut(item, k);
		else checkOut(v, k);
	}

	return { valid: errors.length === 0, errors };
}
