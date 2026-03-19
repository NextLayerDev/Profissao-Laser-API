export function normalizeDigits(value: string): string {
	return value.replace(/\D/g, '');
}

export function isValidCpf(cpf: string): boolean {
	const digits = normalizeDigits(cpf);
	if (digits.length !== 11) return false;
	if (/^(\d)\1{10}$/.test(digits)) return false;

	let sum = 0;
	for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
	let remainder = (sum * 10) % 11;
	if (remainder === 10) remainder = 0;
	if (remainder !== Number(digits[9])) return false;

	sum = 0;
	for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
	remainder = (sum * 10) % 11;
	if (remainder === 10) remainder = 0;
	if (remainder !== Number(digits[10])) return false;

	return true;
}
