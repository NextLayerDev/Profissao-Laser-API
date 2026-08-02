import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv.js';

/**
 * O import de coleção é como a base do Metallic vai ser semeada no dia 1. Um
 * parser ingênuo (`split(',')`) corrompe silenciosamente qualquer linha com
 * vírgula dentro de aspas — e "observações" é exatamente a coluna onde isso
 * acontece o tempo todo.
 */
describe('parseCsv', () => {
	it('cabeçalho e linhas simples', () => {
		expect(parseCsv('a,b,c\n1,2,3')).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		]);
	});

	it('preserva vírgula dentro de aspas', () => {
		const [, row] = parseCsv('material,obs\naco,"corta bem, sem escória"');
		expect(row).toEqual(['aco', 'corta bem, sem escória']);
	});

	it('trata aspas escapadas ("")', () => {
		const [, row] = parseCsv('a\n"ele disse ""ok"" aqui"');
		expect(row).toEqual(['ele disse "ok" aqui']);
	});

	it('preserva quebra de linha dentro de aspas', () => {
		const rows = parseCsv('a,b\n"linha1\nlinha2",x');
		expect(rows).toHaveLength(2);
		expect(rows[1]).toEqual(['linha1\nlinha2', 'x']);
	});

	it('aceita CRLF (arquivo salvo no Windows/Excel)', () => {
		expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
		]);
	});

	it('descarta linha totalmente vazia (arquivo termina em \\n)', () => {
		expect(parseCsv('a,b\n1,2\n')).toEqual([
			['a', 'b'],
			['1', '2'],
		]);
	});

	it('mantém campo vazio no meio', () => {
		expect(parseCsv('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
	});

	it('não confunde aspas no meio de campo não citado', () => {
		expect(parseCsv('a\n3" tubo')[1]).toEqual(['3" tubo']);
	});

	it('linha real de receita de fibra', () => {
		const csv = [
			'title,material,espessura_mm,operacao,gas,pressao_bar,velocidade_mm_s,description',
			'"Aço 3mm, ar comprimido",aco_carbono,3,corte,ar,8,45,"Bom acabamento; testar 40 se houver escória"',
		].join('\n');
		const [header, row] = parseCsv(csv);
		expect(header).toHaveLength(8);
		expect(row).toHaveLength(8);
		expect(row[0]).toBe('Aço 3mm, ar comprimido');
		expect(row[7]).toBe('Bom acabamento; testar 40 se houver escória');
	});
});
