import { loadPublishedToolDefinition } from '../lib/tool-definitions.js';
import {
	getInvocation,
	refundInvocation,
	settleInvocation,
} from '../lib/upvox-tools.js';
import {
	mentorshipRepository as repo,
	type SessionRow,
} from '../repositories/mentorship.js';
import type {
	CreateSession,
	RoomState,
	UpdateSession,
} from '../types/mentorship.js';

/** Erro com status HTTP a propagar (controller mapeia). */
export class MentorshipError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'MentorshipError';
	}
}

/** Contexto de acesso (vem do auth da comunidade + Bearer p/ chamar o upvox). */
export interface RoomAccessCtx {
	planKey?: string | null;
	isUnlimited?: boolean;
	isStaff?: boolean;
	authHeader?: string;
	invocationId?: string | null;
}

interface RoomAccessPolicy {
	includedPlanKeys: string[];
	voxCost: number;
	allowVoxEntry: boolean;
}
interface RoomFeatures {
	recording: boolean;
	chat: boolean;
	materials: boolean;
}
interface RoomData {
	access: RoomAccessPolicy;
	features: RoomFeatures;
}

/** Lê access + features do room da tool publicada (default permissivo se faltar). */
async function loadRoom(
	toolKey: string,
	customerId: string,
	authHeader?: string,
): Promise<RoomData> {
	const def = await loadPublishedToolDefinition(
		toolKey,
		customerId,
		authHeader,
	);
	const a = def.definition.room?.access ?? {};
	const f = def.definition.room?.features ?? {};
	return {
		access: {
			includedPlanKeys: Array.isArray(a.includedPlanKeys)
				? a.includedPlanKeys
				: [],
			voxCost: Number(a.voxCost ?? 0),
			allowVoxEntry: a.allowVoxEntry !== false,
		},
		features: {
			recording: !!f.recording,
			chat: !!f.chat,
			materials: !!f.materials,
		},
	};
}

/** 'included' (plano/staff/unlimited) | 'pay' (voxes) | 'blocked' (só plano). */
function decideAccess(
	access: RoomAccessPolicy,
	ctx: RoomAccessCtx,
): 'included' | 'pay' | 'blocked' {
	if (ctx.isStaff || ctx.isUnlimited) return 'included';
	if (ctx.planKey && access.includedPlanKeys.includes(ctx.planKey))
		return 'included';
	if (!access.allowVoxEntry) return 'blocked';
	return 'pay';
}

/** Timing da sessão em BRT (UTC-3): início, abertura, live/encerrado. */
function timing(session: SessionRow) {
	const time = session.time && session.time.length > 0 ? session.time : '00:00';
	const startsAt = new Date(`${session.date}T${time}:00-03:00`);
	const opensAt = new Date(
		startsAt.getTime() - (session.joinOpensMinutesBefore ?? 10) * 60_000,
	);
	const endsAt = new Date(
		startsAt.getTime() + (session.durationMin ?? 60) * 60_000,
	);
	const now = new Date();
	return {
		startsAt,
		opensAt,
		isOpen: now >= opensAt,
		isLive: now >= startsAt && now < endsAt,
		hasEnded: now >= endsAt,
	};
}

function sessionPublic(s: SessionRow) {
	return {
		id: s.id,
		toolKey: s.toolKey,
		title: s.title,
		description: s.description,
		date: s.date,
		time: s.time,
		durationMin: s.durationMin,
		joinOpensMinutesBefore: s.joinOpensMinutesBefore,
		cap: s.cap,
		recordingUrl: s.recordingUrl,
		hostId: s.hostId,
	};
}

export const mentorshipService = {
	listSessions(toolKey: string) {
		return repo.listSessions(toolKey).then((rows) => rows.map(sessionPublic));
	},

	createSession(toolKey: string, data: CreateSession) {
		return repo.createSession(toolKey, data).then(sessionPublic);
	},

	updateSession(id: string, data: UpdateSession) {
		return repo.updateSession(id, data).then(sessionPublic);
	},

	deleteSession(id: string) {
		return repo.deleteSession(id);
	},

	/** Estado da sala (sem cobrar). Revela o link só a quem já entrou. */
	async getRoomState(
		sessionId: string,
		customerId: string,
		ctx: RoomAccessCtx,
	): Promise<RoomState> {
		const session = await repo.findSessionById(sessionId);
		const room = await loadRoom(session.toolKey, customerId, ctx.authHeader);
		const t = timing(session);
		const [attendees, activeRow, activeCount] = await Promise.all([
			t.isOpen ? repo.listAttendees(sessionId) : Promise.resolve([]),
			repo.findActiveAttendance(sessionId, customerId),
			repo.countActive(sessionId),
		]);
		const hasJoined = !!activeRow;
		return {
			session: sessionPublic(session),
			isOpen: t.isOpen,
			isLive: t.isLive,
			hasEnded: t.hasEnded,
			startsAt: t.startsAt.toISOString(),
			opensAt: t.opensAt.toISOString(),
			attendees,
			activeCount,
			hasJoined,
			access: decideAccess(room.access, ctx),
			voxCost: room.access.voxCost,
			features: room.features,
			// Link só sai pra quem já entrou (defesa em profundidade).
			externalUrl: hasJoined ? session.externalUrl : null,
		};
	},

	/**
	 * Entrar na sala: gateia por plano/voxes, respeita cap, registra presença e
	 * revela o link. Reentrar (ativo) ou já ter pago a sessão não recobra.
	 */
	async joinRoom(sessionId: string, customerId: string, ctx: RoomAccessCtx) {
		const session = await repo.findSessionById(sessionId);

		// Já está dentro → reusa (sem cobrança).
		const activeRow = await repo.findActiveAttendance(sessionId, customerId);
		if (activeRow) {
			return {
				externalUrl: session.externalUrl,
				state: await this.getRoomState(sessionId, customerId, ctx),
			};
		}

		const { access } = await loadRoom(
			session.toolKey,
			customerId,
			ctx.authHeader,
		);
		const decision = decideAccess(access, ctx);
		if (decision === 'blocked') {
			throw new MentorshipError(403, 'plan_not_allowed');
		}

		// Decide a cobrança (só se NÃO for incluído).
		let paidInvocationId: string | null = null;
		let freshlyPaid = false;
		if (decision === 'pay') {
			const prior = await repo.findPaidAttendance(sessionId, customerId);
			if (prior?.paidInvocationId) {
				paidInvocationId = prior.paidInvocationId; // já pagou esta sessão
			} else {
				if (!ctx.invocationId) {
					throw new MentorshipError(402, 'payment_required');
				}
				const inv = await getInvocation(
					customerId,
					ctx.invocationId,
					ctx.authHeader,
				);
				if (
					!inv ||
					inv.status !== 'pending' ||
					inv.tool_key !== session.toolKey ||
					inv.customer_id !== customerId
				) {
					throw new MentorshipError(403, 'invalid_invocation');
				}
				paidInvocationId = inv.id;
				freshlyPaid = true;
			}
		}

		// Cap (presença ativa). Se lotou e acabou de pagar fresco, refunda.
		if (session.cap != null) {
			const active = await repo.countActive(sessionId);
			if (active >= session.cap) {
				if (freshlyPaid && paidInvocationId) {
					await refundInvocation(customerId, paidInvocationId, ctx.authHeader);
				}
				throw new MentorshipError(409, 'room_full');
			}
		}

		await repo.insertAttendance(sessionId, customerId, paidInvocationId);
		// Liquida a cobrança agora que a entrada deu certo (idempotente).
		if (paidInvocationId) {
			await settleInvocation(customerId, paidInvocationId, ctx.authHeader);
		}

		return {
			externalUrl: session.externalUrl,
			state: await this.getRoomState(sessionId, customerId, ctx),
		};
	},

	leaveRoom(sessionId: string, customerId: string) {
		return repo.leaveAttendance(sessionId, customerId);
	},

	/** Presença completa da sessão p/ o admin acompanhar (staff — gate no controller). */
	listSessionAttendees(sessionId: string) {
		return repo.listAllAttendees(sessionId);
	},

	// ── materiais ──────────────────────────────────────────────────────────────

	/** Lista materiais — visível a quem é incluído (plano/staff) ou já entrou. */
	async listMaterials(
		sessionId: string,
		customerId: string,
		ctx: RoomAccessCtx,
	) {
		const session = await repo.findSessionById(sessionId);
		const { access } = await loadRoom(
			session.toolKey,
			customerId,
			ctx.authHeader,
		);
		const activeRow = await repo.findActiveAttendance(sessionId, customerId);
		if (decideAccess(access, ctx) !== 'included' && !activeRow) {
			throw new MentorshipError(403, 'not_in_room');
		}
		return repo.listMaterials(sessionId);
	},

	addMaterial(sessionId: string, title: string, url: string) {
		return repo.insertMaterial(sessionId, title, url);
	},

	deleteMaterial(id: string) {
		return repo.deleteMaterial(id);
	},

	// ── chat ────────────────────────────────────────────────────────────────────

	/** Pré-condição do chat: estar ATIVO na sala (entrou e não saiu). */
	async assertInRoom(sessionId: string, customerId: string) {
		const activeRow = await repo.findActiveAttendance(sessionId, customerId);
		if (!activeRow) throw new MentorshipError(403, 'not_in_room');
	},

	async listMessages(sessionId: string, customerId: string) {
		await this.assertInRoom(sessionId, customerId);
		return repo.listMessages(sessionId);
	},

	async postMessage(
		sessionId: string,
		customer: { id: string; name: string | null; image: string | null },
		content: string,
	) {
		await this.assertInRoom(sessionId, customer.id);
		const row = await repo.insertMessage(sessionId, customer.id, content);
		return {
			id: row.id,
			customerId: customer.id,
			customerName: customer.name,
			customerImage: customer.image,
			content: row.content,
			createdAt: row.createdAt,
		};
	},
};
