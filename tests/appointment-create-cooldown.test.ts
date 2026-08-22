import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `external-auth` lê EXTERNAL_API_URL no import e explode sem env — e aqui só
// interessa o recorte de quem é staff.
vi.mock('../src/lib/external-auth.js', () => ({
	isStaffRole: (role: string | null | undefined) =>
		role === 'admin' || role === 'staff',
}));

vi.mock('../src/repositories/appointment.js', () => ({
	appointmentRepository: {
		create: vi.fn(),
		listTechnicianIds: vi.fn(),
		listByDate: vi.fn(),
	},
}));

vi.mock('../src/services/appointment-config.js', () => ({
	appointmentConfigService: { checkClientCooldown: vi.fn() },
}));

import { createAppointmentController } from '../src/controllers/appointment.js';
import { appointmentRepository } from '../src/repositories/appointment.js';
import { appointmentConfigService } from '../src/services/appointment-config.js';

const LIVRE = { blocked: false, hours: 48, conflict: null };

const CONFLITO = {
	blocked: true,
	hours: 48,
	conflict: {
		appointment: {
			id: 'a1',
			customerEmail: 'cliente@teste.com',
			customerPhone: '11987654321',
			date: '2026-08-24',
			time: '10:00',
		},
		nextAllowedDate: '2026-08-26',
		nextAllowedTime: '10:00',
	},
};

function body(over: Record<string, unknown> = {}) {
	return {
		customerName: 'Cliente',
		customerEmail: 'cliente@teste.com',
		customerPhone: '11987654321',
		service: 'Corte',
		machine: 'CO2',
		date: '2026-08-25',
		time: '09:00',
		...over,
	};
}

async function buildApp(role: string, email = 'cliente@teste.com') {
	const app: FastifyInstance = Fastify();
	app.post(
		'/appointment',
		{
			preHandler: async (req) => {
				req.currentUser = {
					id: 'user-1',
					email,
					phone: '11987654321',
					name: 'Cliente',
					role,
					blocked: false,
				};
				req.currentRole = role;
			},
		},
		createAppointmentController,
	);
	return app;
}

describe('POST /appointment — intervalo mínimo entre atendimentos', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(appointmentRepository.listTechnicianIds).mockResolvedValue([]);
		vi.mocked(appointmentRepository.create).mockResolvedValue({
			id: 'novo',
		} as never);
	});

	it('nunca deixa `overrideCooldown` chegar no insert', async () => {
		// `repository.create` faz `...data` direto no insert do Supabase, e
		// `overrideCooldown` não é coluna: se vazar, TODO agendamento quebra com
		// "column does not exist".
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			LIVRE as never,
		);
		const app = await buildApp('admin', 'admin@teste.com');

		const res = await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body({ overrideCooldown: true }),
		});

		expect(res.statusCode).toBe(201);
		const arg = vi.mocked(appointmentRepository.create).mock.calls[0][0];
		expect(arg).not.toHaveProperty('overrideCooldown');
	});

	it('força o e-mail do token para quem não é staff', async () => {
		// Sem isto o intervalo é furado em um passo: basta o cliente mandar outro
		// e-mail no body pra a checagem olhar a agenda de outra pessoa.
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			LIVRE as never,
		);
		const app = await buildApp('customer', 'dono-do-token@teste.com');

		await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body({ customerEmail: 'vitima@teste.com' }),
		});

		expect(appointmentConfigService.checkClientCooldown).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'dono-do-token@teste.com' }),
		);
		const arg = vi.mocked(appointmentRepository.create).mock.calls[0][0];
		expect(arg.customerEmail).toBe('dono-do-token@teste.com');
	});

	it('não mexe no e-mail quando é a equipe marcando pelo cliente', async () => {
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			LIVRE as never,
		);
		const app = await buildApp('admin', 'admin@teste.com');

		await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body({ customerEmail: 'cliente@teste.com' }),
		});

		const arg = vi.mocked(appointmentRepository.create).mock.calls[0][0];
		expect(arg.customerEmail).toBe('cliente@teste.com');
	});

	it('responde 409 com código e motivo legível quando o intervalo barra', async () => {
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			CONFLITO as never,
		);
		const app = await buildApp('customer');

		const res = await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body(),
		});

		expect(res.statusCode).toBe(409);
		const json = res.json();
		expect(json.code).toBe('client_cooldown');
		expect(json.message).toContain('Você já tem');
		expect(json.message).toContain('24/08');
		expect(json.message).toContain('26/08');
		expect(appointmentRepository.create).not.toHaveBeenCalled();
	});

	it('usa a voz da equipe na mensagem quando quem marca é o painel', async () => {
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			CONFLITO as never,
		);
		const app = await buildApp('admin', 'admin@teste.com');

		const res = await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body(),
		});

		expect(res.statusCode).toBe(409);
		expect(res.json().message).toContain('Este cliente já tem');
	});

	it('staff com override pula a checagem inteira', async () => {
		const app = await buildApp('admin', 'admin@teste.com');

		const res = await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body({ overrideCooldown: true }),
		});

		expect(res.statusCode).toBe(201);
		expect(appointmentConfigService.checkClientCooldown).not.toHaveBeenCalled();
	});

	it('cliente não consegue se auto-liberar mandando override', async () => {
		vi.mocked(appointmentConfigService.checkClientCooldown).mockResolvedValue(
			CONFLITO as never,
		);
		const app = await buildApp('customer');

		const res = await app.inject({
			method: 'POST',
			url: '/appointment',
			payload: body({ overrideCooldown: true }),
		});

		expect(res.statusCode).toBe(409);
	});
});
