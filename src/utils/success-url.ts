import { supabase } from '../lib/supabase.js';

export async function resolveSuccessUrl(productId: string): Promise<string> {
	const { data: scLinks } = await supabase
		.from('pl_system_class_product')
		.select('pl_system_class(gerenciamentoSistema)')
		.eq('productId', productId)
		.limit(1);

	const gerenciamentoSistema =
		(
			scLinks?.[0]?.pl_system_class as unknown as {
				gerenciamentoSistema: boolean;
			} | null
		)?.gerenciamentoSistema ?? false;

	if (gerenciamentoSistema) {
		return `${process.env.SUCCESS_URL ?? 'http://localhost:3000/checkout/success'}?session_id={CHECKOUT_SESSION_ID}`;
	}

	return `${process.env.COURSES_URL ?? 'https://profissaolaser.com.br/cursos'}?session_id={CHECKOUT_SESSION_ID}`;
}
