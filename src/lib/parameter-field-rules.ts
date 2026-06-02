/**
 * Aplicabilidade de campos por tipo de máquina + modo (A4/A5).
 *
 * Campos "sempre usados" (speed, power, line, passes, defocus) não entram aqui.
 * Os "condicionais" abaixo são mostrados/exigidos só quando aplicáveis:
 *   - frequency  → só Fiber e UV (CO2/Diodo não usam).
 *   - qPulse     → só UV (parâmetro Q-switch).
 *   - gas        → CO2 ou qualquer máquina em Corte (assistência de ar/gás).
 *   - crossHatch → preenchimento cruzado: não no Corte.
 *   - angle      → ângulo de hachura: não no Corte.
 *   - passesFill → passadas de preenchimento: não no Corte.
 *
 * Mesma lógica é espelhada no front (utils/constants/parameter-field-rules.ts)
 * para o form dinâmico e o "—" nos cards. Mantê-los em sincronia.
 */

export type MachineType = 'Fiber' | 'CO2' | 'UV' | 'Diodo' | 'Outro';

export type GateableField =
	| 'frequency'
	| 'qPulse'
	| 'gas'
	| 'crossHatch'
	| 'angle'
	| 'passesFill';

export function machineTypeOf(machine?: string | null): MachineType {
	const m = (machine ?? '').toLowerCase();
	if (m.includes('fiber')) return 'Fiber';
	if (m.includes('co2') || m.includes('co₂')) return 'CO2';
	if (m.includes('uv')) return 'UV';
	if (m.includes('diodo') || m.includes('diode')) return 'Diodo';
	return 'Outro';
}

/** Mapa {campo condicional → aplicável?} para uma máquina/modo. */
export function applicableFields(
	machine?: string | null,
	mode?: string | null,
): Record<GateableField, boolean> {
	const t = machineTypeOf(machine);
	// Máquina desconhecida: não esconde nada (permissivo, exceto Q-pulse só-UV).
	if (t === 'Outro') {
		return {
			frequency: true,
			qPulse: false,
			gas: true,
			crossHatch: true,
			angle: true,
			passesFill: true,
		};
	}
	const isCut = (mode ?? '').toLowerCase().startsWith('cort'); // "Corte"
	return {
		frequency: t === 'Fiber' || t === 'UV',
		qPulse: t === 'UV',
		gas: t === 'CO2' || isCut,
		crossHatch: !isCut,
		angle: !isCut,
		passesFill: !isCut,
	};
}
