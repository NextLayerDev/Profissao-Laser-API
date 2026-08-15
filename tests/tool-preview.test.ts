import { afterEach, describe, expect, it } from 'vitest';
import {
	isPreviewOnlyTool,
	isToolPreviewUser,
} from '../src/lib/tool-preview.js';

/**
 * O preview de rascunho é a única coisa que faz um ALUNO enxergar uma tool não
 * publicada. Ele vale por duas listas que precisam casar — testador E tool —, e
 * o padrão de ambas é "vazia = ninguém/nenhuma". Se este arquivo passar a
 * reprovar, alguém afrouxou o portão.
 */

const USERS = process.env.TOOL_PREVIEW_USERS;
const KEYS = process.env.TOOL_PREVIEW_KEYS;

afterEach(() => {
	if (USERS === undefined) delete process.env.TOOL_PREVIEW_USERS;
	else process.env.TOOL_PREVIEW_USERS = USERS;
	if (KEYS === undefined) delete process.env.TOOL_PREVIEW_KEYS;
	else process.env.TOOL_PREVIEW_KEYS = KEYS;
});

describe('allowlist de testadores', () => {
	it('env ausente ou vazia ⇒ ninguém (o padrão de produção)', () => {
		delete process.env.TOOL_PREVIEW_USERS;
		expect(isToolPreviewUser('qualquer-id', 'a@b.com')).toBe(false);
		process.env.TOOL_PREVIEW_USERS = '   ,  ,';
		expect(isToolPreviewUser('qualquer-id', 'a@b.com')).toBe(false);
	});

	it('casa por id OU por e-mail, sem diferenciar maiúscula', () => {
		process.env.TOOL_PREVIEW_USERS = ' 1A3D36EF-BB5E , Fulano@Exemplo.COM ';
		expect(isToolPreviewUser('1a3d36ef-bb5e', null)).toBe(true);
		expect(isToolPreviewUser(null, 'fulano@exemplo.com')).toBe(true);
		expect(isToolPreviewUser('outro-id', 'outro@exemplo.com')).toBe(false);
	});

	it('id vazio não casa com entrada vazia da lista', () => {
		process.env.TOOL_PREVIEW_USERS = 'a@b.com';
		expect(isToolPreviewUser('', '')).toBe(false);
	});
});

describe('allowlist de tools', () => {
	it('env ausente ⇒ nenhuma tool é preview', () => {
		delete process.env.TOOL_PREVIEW_KEYS;
		expect(isPreviewOnlyTool('metallic')).toBe(false);
	});

	it('só as keys listadas, sem diferenciar maiúscula', () => {
		process.env.TOOL_PREVIEW_KEYS = 'metallic, Estudio_CAD';
		expect(isPreviewOnlyTool('metallic')).toBe(true);
		expect(isPreviewOnlyTool('ESTUDIO_CAD')).toBe(true);
		// Uma tool publicada em produção NUNCA pode cair aqui — se caísse, o
		// carregamento dela passaria a usar chave de cache por usuário.
		expect(isPreviewOnlyTool('prompts_magicos')).toBe(false);
	});

	it('as duas listas são AND: testador certo, tool errada ⇒ sem preview', () => {
		process.env.TOOL_PREVIEW_USERS = 'a@b.com';
		process.env.TOOL_PREVIEW_KEYS = 'metallic';
		const testador = isToolPreviewUser(null, 'a@b.com');
		expect(testador && isPreviewOnlyTool('metallic')).toBe(true);
		expect(testador && isPreviewOnlyTool('estudio_laser')).toBe(false);
	});
});
