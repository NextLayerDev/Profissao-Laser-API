import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

// O webhook da main API cuida do plano do TENANT (system_porteira). Eventos da
// assinatura de complemento não podem rebaixar o plano nem cancelar o tenant.
vi.mock('../src/lib/stripe.js', () => ({ stripe: {} }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../src/lib/crypto.js', () => ({ decrypt: vi.fn() }));
vi.mock('../src/lib/postgres-runner.js', () => ({ runSqlOnTenant: vi.fn() }));
vi.mock('../src/lib/vercel.js', () => ({}));
vi.mock('../src/workers/provision-tenant.js', () => ({
	runProvisionTenant: vi.fn(),
}));

import { isAddonEvent } from '../src/routes/webhook.js';

const event = (type: string, object: Record<string, unknown>) =>
	({ type, data: { object } }) as unknown as Stripe.Event;

describe('isAddonEvent', () => {
	it('assinatura de complemento (created/updated/deleted)', () => {
		expect(
			isAddonEvent(
				event('customer.subscription.deleted', {
					object: 'subscription',
					metadata: { kind: 'addon' },
				}),
			),
		).toBe(true);
	});

	it('fatura de complemento (paid/failed)', () => {
		expect(
			isAddonEvent(
				event('invoice.payment_failed', {
					object: 'invoice',
					parent: { subscription_details: { metadata: { kind: 'addon' } } },
				}),
			),
		).toBe(true);
	});

	it('plano, fatura do plano e checkout seguem tratados', () => {
		expect(
			isAddonEvent(
				event('customer.subscription.updated', {
					object: 'subscription',
					metadata: { plan_id: 'p' },
				}),
			),
		).toBe(false);
		expect(
			isAddonEvent(
				event('invoice.payment_succeeded', {
					object: 'invoice',
					parent: { subscription_details: { metadata: {} } },
				}),
			),
		).toBe(false);
		expect(
			isAddonEvent(
				event('checkout.session.completed', {
					object: 'checkout.session',
					metadata: { kind: 'addon' },
				}),
			),
		).toBe(false);
	});
});
