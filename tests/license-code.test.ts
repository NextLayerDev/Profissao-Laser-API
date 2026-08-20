import { describe, expect, it } from 'vitest';
import {
	gerarCodigoLicenca,
	hashCodigo,
	normalizarCodigo,
} from '../src/lib/license-code.js';

describe('código de autenticidade da arte licenciada', () => {
	it('sai no formato PL-XXXXX-XXXXX-XXXXX-XXXXX', () => {
		expect(gerarCodigoLicenca()).toMatch(/^PL(-[0-9A-HJ-NP-TV-Z]{5}){4}$/);
	});

	it('não usa caracteres ambíguos', () => {
		// I/L/1 e O/0 se confundem numa gravação a laser fotografada de lado.
		// Quem digita o código errado não acha a peça.
		//
		// Só o CORPO entra na conta: o prefixo "PL-" é fixo e escolhido por nós,
		// e tem um L de propósito.
		const corpos = Array.from({ length: 300 }, () =>
			gerarCodigoLicenca().slice('PL-'.length),
		).join('');
		expect(corpos).not.toMatch(/[ILOU]/);
	});

	it('não repete em 5000 gerações', () => {
		const vistos = new Set(
			Array.from({ length: 5000 }, () => gerarCodigoLicenca()),
		);
		expect(vistos.size).toBe(5000);
	});

	it('aceita o prefixo da plataforma', () => {
		expect(gerarCodigoLicenca('AL')).toMatch(/^AL-/);
	});

	it('normaliza caixa e espaço antes de comparar', () => {
		// Quem digita o código do QR erra caixa e espaço. Sem normalizar, a peça
		// legítima daria "não encontrado" — que é o pior falso negativo possível
		// numa tela que atesta autenticidade.
		const c = gerarCodigoLicenca();
		expect(normalizarCodigo(`  ${c.toLowerCase()} `)).toBe(c);
		expect(hashCodigo(`  ${c.toLowerCase()} `)).toBe(hashCodigo(c));
	});

	it('o hash é estável e não devolve o código', () => {
		const c = gerarCodigoLicenca();
		const h = hashCodigo(c);
		expect(h).toHaveLength(64);
		expect(h).toBe(hashCodigo(c));
		expect(h).not.toContain(c);
	});

	it('códigos diferentes têm hashes diferentes', () => {
		expect(hashCodigo(gerarCodigoLicenca())).not.toBe(
			hashCodigo(gerarCodigoLicenca()),
		);
	});
});
