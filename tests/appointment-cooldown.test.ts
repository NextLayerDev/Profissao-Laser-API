import { describe, expect, it } from 'vitest';
import {
	addDays,
	type CooldownAppointment,
	findCooldownConflict,
	formatCooldownMessage,
	isDayFullyBlocked,
	matchesClient,
	normalizePhone,
	toCalendarMinutes,
} from '../src/lib/appointment-cooldown.js';

// Segunda-feira. Tudo abaixo gira em torno deste atendimento.
const SEGUNDA = '2026-08-24';

function apt(
	date: string,
	time: string,
	over: Partial<CooldownAppointment> = {},
): CooldownAppointment {
	return {
		id: `${date}-${time}`,
		customerEmail: 'cliente@teste.com',
		customerPhone: '11987654321',
		date,
		time,
		service: 'Corte',
		...over,
	};
}

describe('aritmética de calendário', () => {
	it('mede horas de parede sem depender do fuso do processo', () => {
		// Duas datas quaisquer: a diferença tem de ser exatamente 2 dias em
		// minutos. Se a conta passasse por `new Date("...T...")` local, um
		// container em UTC e um Mac em BRT dariam respostas diferentes.
		const a = toCalendarMinutes('2026-10-18', '10:00');
		const b = toCalendarMinutes('2026-10-20', '10:00');
		expect(b - a).toBe(2880);
	});

	it('soma dias atravessando virada de mês e ano', () => {
		expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // bissexto
	});
});

describe('intervalo mínimo entre atendimentos (48h)', () => {
	const existentes = [apt(SEGUNDA, '10:00')];
	const H = 48;

	it('bloqueia o dia seguinte', () => {
		const hit = findCooldownConflict(
			{ date: '2026-08-25', time: '09:00' },
			existentes,
			H,
		);
		expect(hit).not.toBeNull();
		expect(hit?.nextAllowedDate).toBe('2026-08-26');
		expect(hit?.nextAllowedTime).toBe('10:00');
	});

	it('libera exatamente no limite, e bloqueia um minuto antes', () => {
		// A janela é ABERTA: 48h cravadas já vale. Sem isso, "intervalo de 48h"
		// na verdade seria 48h+1min, e o cliente que faz a conta certa levaria
		// um erro que não sabe explicar.
		expect(
			findCooldownConflict(
				{ date: '2026-08-26', time: '10:00' },
				existentes,
				H,
			),
		).toBeNull();
		expect(
			findCooldownConflict(
				{ date: '2026-08-26', time: '09:59' },
				existentes,
				H,
			),
		).not.toBeNull();
	});

	it('vale para trás também', () => {
		// Marcar ANTES do atendimento existente também tem de respeitar o
		// intervalo — senão o cliente reserva quinta e depois volta e pega
		// quarta, que é exatamente o comportamento que a regra existe pra impedir.
		expect(
			findCooldownConflict(
				{ date: '2026-08-22', time: '11:00' },
				existentes,
				H,
			),
		).not.toBeNull();
		expect(
			findCooldownConflict(
				{ date: '2026-08-22', time: '10:00' },
				existentes,
				H,
			),
		).toBeNull();
	});

	it('isenta horários no mesmo dia', () => {
		// Dois horários no mesmo dia são UMA visita (sessão longa), e é assim
		// que o painel cria vários slots de uma vez pro mesmo cliente.
		expect(
			findCooldownConflict({ date: SEGUNDA, time: '08:00' }, existentes, H),
		).toBeNull();
		expect(
			findCooldownConflict({ date: SEGUNDA, time: '17:00' }, existentes, H),
		).toBeNull();
	});

	it('escolhe o atendimento que empurra mais longe, não o primeiro da lista', () => {
		const dois = [apt(SEGUNDA, '10:00'), apt('2026-08-26', '10:00')];
		const hit = findCooldownConflict(
			{ date: '2026-08-25', time: '10:00' },
			dois,
			H,
		);
		expect(hit?.appointment.date).toBe('2026-08-26');
		expect(hit?.nextAllowedDate).toBe('2026-08-28');
	});

	it('lista vazia nunca bloqueia', () => {
		expect(
			findCooldownConflict({ date: '2026-08-25', time: '10:00' }, [], H),
		).toBeNull();
	});
});

describe('dia inteiro bloqueado', () => {
	const existentes = [apt(SEGUNDA, '10:00')];

	it('marca como cheio os dias cobertos de ponta a ponta', () => {
		expect(isDayFullyBlocked('2026-08-23', existentes, 48)).toBe(true);
		expect(isDayFullyBlocked('2026-08-25', existentes, 48)).toBe(true);
	});

	it('não marca dias só parcialmente cobertos', () => {
		// 26/08 libera às 10:00 — o dia continua selecionável, e quem filtra os
		// horários é o seletor.
		expect(isDayFullyBlocked('2026-08-26', existentes, 48)).toBe(false);
		expect(isDayFullyBlocked('2026-08-22', existentes, 48)).toBe(false);
	});

	it('nunca marca o próprio dia do atendimento', () => {
		expect(isDayFullyBlocked(SEGUNDA, existentes, 48)).toBe(false);
	});

	it('com intervalo menor que 24h nenhum dia fica cheio', () => {
		expect(isDayFullyBlocked('2026-08-25', existentes, 12)).toBe(false);
	});
});

describe('identidade do cliente', () => {
	it('normaliza telefone descartando máscara e DDI', () => {
		expect(normalizePhone('+55 (11) 98765-4321')).toBe('11987654321');
		expect(normalizePhone('11987654321')).toBe('11987654321');
	});

	it('descarta telefone curto, vazio ou lixo', () => {
		// '' não pode virar chave: senão TODO agendamento sem telefone casaria
		// com todo outro, e a agenda inteira travaria de uma vez.
		expect(normalizePhone('1234')).toBe('');
		expect(normalizePhone('')).toBe('');
		expect(normalizePhone(null)).toBe('');
		expect(normalizePhone('não informado')).toBe('');
	});

	it('casa e-mail ignorando caixa e espaço', () => {
		const a = apt(SEGUNDA, '10:00', { customerEmail: 'Joao@Teste.COM' });
		expect(
			matchesClient(a, { email: ' joao@teste.com ', phone: null }, false),
		).toBe(true);
	});

	it('não casa nada quando a identidade está vazia', () => {
		const a = apt(SEGUNDA, '10:00', { customerEmail: '', customerPhone: '' });
		expect(matchesClient(a, { email: '', phone: '' }, true)).toBe(false);
		expect(matchesClient(a, { email: null, phone: null }, true)).toBe(false);
	});

	it('só olha telefone quando a opção está ligada', () => {
		const a = apt(SEGUNDA, '10:00', { customerEmail: 'outro@teste.com' });
		const who = { email: 'cliente@teste.com', phone: '(11) 98765-4321' };
		expect(matchesClient(a, who, false)).toBe(false);
		expect(matchesClient(a, who, true)).toBe(true);
	});
});

describe('mensagem de erro', () => {
	it('diz o que já existe e a partir de quando libera', () => {
		const hit = findCooldownConflict(
			{ date: '2026-08-25', time: '09:00' },
			[apt(SEGUNDA, '10:00')],
			48,
		);
		if (!hit) throw new Error('esperava conflito');

		const cliente = formatCooldownMessage(hit, 48, 'customer');
		expect(cliente).toContain('Você já tem');
		expect(cliente).toContain('24/08');
		expect(cliente).toContain('26/08');
		expect(cliente).toContain('48h');

		expect(formatCooldownMessage(hit, 48, 'staff')).toContain(
			'Este cliente já tem',
		);
	});
});
