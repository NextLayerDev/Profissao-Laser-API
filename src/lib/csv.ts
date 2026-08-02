/**
 * Parser e serializador de CSV mínimos, sem dependência.
 *
 * Existe porque o import de coleção é como uma base grande (o Metallic, a
 * tabela de materiais, as velocidades de corte) vai ser semeada, e um
 * `split(',')` ingênuo corrompe em silêncio qualquer linha com vírgula dentro
 * de aspas — que é justamente o caso da coluna de observações.
 *
 * Cobre o que aparece em arquivo de verdade: aspas, aspas escapadas (`""`),
 * separador e quebra de linha dentro de aspas, e CRLF (Excel no Windows).
 */

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		// Aspa só ABRE citação no início do campo. No meio de um campo não citado
		// ela é texto literal — `3" tubo` é uma medida em polegadas, não CSV
		// malformado, e aparece o tempo todo em base de material.
		if (c === '"' && field === '') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.some((v) => v !== '')) rows.push(row);
			row = [];
		} else field += c;
	}
	row.push(field);
	if (row.some((v) => v !== '')) rows.push(row);
	return rows;
}

/** Escapa um valor para CSV, citando só quando necessário. */
export function csvCell(v: unknown): string {
	const s = v === undefined || v === null ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta um CSV a partir de cabeçalho + linhas já na ordem das colunas. */
export function toCsv(header: string[], rows: unknown[][]): string {
	return [
		header.map(csvCell).join(','),
		...rows.map((r) => r.map(csvCell).join(',')),
	].join('\n');
}
