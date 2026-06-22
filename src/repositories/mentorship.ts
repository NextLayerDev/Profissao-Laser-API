import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import type { CreateSession, UpdateSession } from '../types/mentorship.js';

const SESSION_COLS =
	'id, "toolKey", title, description, date, time, "durationMin", "joinOpensMinutesBefore", "externalUrl", cap, "recordingUrl", "hostId"';

/** Linha crua da sessão (inclui externalUrl — o service decide se revela). */
export interface SessionRow {
	id: string;
	toolKey: string;
	title: string;
	description: string | null;
	date: string;
	time: string | null;
	durationMin: number;
	joinOpensMinutesBefore: number;
	externalUrl: string;
	cap: number | null;
	recordingUrl: string | null;
	hostId: string | null;
}

class MentorshipRepository {
	async listSessions(toolKey: string): Promise<SessionRow[]> {
		const { data, error } = await supabase
			.from('pl_mentorship_session')
			.select(SESSION_COLS)
			.eq('toolKey', toolKey)
			.order('date', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as unknown as SessionRow[];
	}

	async findSessionById(id: string): Promise<SessionRow> {
		const { data, error } = await supabase
			.from('pl_mentorship_session')
			.select(SESSION_COLS)
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('session_not_found');
		return data as unknown as SessionRow;
	}

	async createSession(
		toolKey: string,
		data: CreateSession,
	): Promise<SessionRow> {
		const { data: row, error } = await supabase
			.from('pl_mentorship_session')
			.insert({ id: crypto.randomUUID(), toolKey, ...data })
			.select(SESSION_COLS)
			.single();
		if (error) throw new Error(error.message);
		return row as unknown as SessionRow;
	}

	async updateSession(id: string, data: UpdateSession): Promise<SessionRow> {
		const { data: row, error } = await supabase
			.from('pl_mentorship_session')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select(SESSION_COLS)
			.single();
		if (error) throw new Error(error.message);
		return row as unknown as SessionRow;
	}

	async deleteSession(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_mentorship_session')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── presença ──────────────────────────────────────────────────────────────

	async findActiveAttendance(
		sessionId: string,
		customerId: string,
	): Promise<{ id: string } | null> {
		const { data } = await supabase
			.from('pl_mentorship_attendance')
			.select('id')
			.eq('sessionId', sessionId)
			.eq('customerId', customerId)
			.is('leftAt', null)
			.maybeSingle();
		return (data as { id: string } | null) ?? null;
	}

	/** Qualquer presença (ativa ou não) que JÁ pagou esta sessão (idempotência). */
	async findPaidAttendance(
		sessionId: string,
		customerId: string,
	): Promise<{ paidInvocationId: string } | null> {
		const { data } = await supabase
			.from('pl_mentorship_attendance')
			.select('paidInvocationId')
			.eq('sessionId', sessionId)
			.eq('customerId', customerId)
			.not('paidInvocationId', 'is', null)
			.order('joinedAt', { ascending: false })
			.limit(1)
			.maybeSingle();
		return (data as { paidInvocationId: string } | null) ?? null;
	}

	async countActive(sessionId: string): Promise<number> {
		const { count, error } = await supabase
			.from('pl_mentorship_attendance')
			.select('id', { count: 'exact', head: true })
			.eq('sessionId', sessionId)
			.is('leftAt', null);
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async insertAttendance(
		sessionId: string,
		customerId: string,
		paidInvocationId: string | null,
	): Promise<void> {
		const { error } = await supabase
			.from('pl_mentorship_attendance')
			.insert({ sessionId, customerId, paidInvocationId });
		if (error) throw new Error(error.message);
	}

	async leaveAttendance(sessionId: string, customerId: string): Promise<void> {
		const { error } = await supabase
			.from('pl_mentorship_attendance')
			.update({ leftAt: new Date().toISOString() })
			.eq('sessionId', sessionId)
			.eq('customerId', customerId)
			.is('leftAt', null);
		if (error) throw new Error(error.message);
	}

	async listAttendees(sessionId: string) {
		const { data, error } = await supabase
			.from('pl_mentorship_attendance')
			.select(
				'customerId, joinedAt, Customers!inner(id, name, pl_community_profile(image))',
			)
			.eq('sessionId', sessionId)
			.is('leftAt', null)
			.order('joinedAt', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []).map((row) => {
			// biome-ignore lint/suspicious/noExplicitAny: join aninhado dinâmico
			const r = row as any;
			const customer = r.Customers;
			const profileList = customer?.pl_community_profile;
			const profile = Array.isArray(profileList) ? profileList[0] : profileList;
			return {
				customerId: r.customerId as string,
				customerName: (customer?.name as string | null) ?? null,
				customerImage: (profile?.image as string | null) ?? null,
				joinedAt: r.joinedAt as string,
			};
		});
	}

	/** Presença COMPLETA (ativos + que saíram) p/ o admin acompanhar a sessão. */
	async listAllAttendees(sessionId: string) {
		const { data, error } = await supabase
			.from('pl_mentorship_attendance')
			.select(
				'customerId, joinedAt, leftAt, paidInvocationId, Customers!inner(id, name, pl_community_profile(image))',
			)
			.eq('sessionId', sessionId)
			.order('joinedAt', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []).map((row) => {
			// biome-ignore lint/suspicious/noExplicitAny: join aninhado dinâmico
			const r = row as any;
			const customer = r.Customers;
			const profileList = customer?.pl_community_profile;
			const profile = Array.isArray(profileList) ? profileList[0] : profileList;
			return {
				customerId: r.customerId as string,
				customerName: (customer?.name as string | null) ?? null,
				customerImage: (profile?.image as string | null) ?? null,
				joinedAt: r.joinedAt as string,
				leftAt: (r.leftAt as string | null) ?? null,
				paid: !!r.paidInvocationId,
			};
		});
	}

	// ── materiais ───────────────────────────────────────────────────────────────

	async listMaterials(sessionId: string) {
		const { data, error } = await supabase
			.from('pl_mentorship_material')
			.select('id, "sessionId", title, url, "createdAt"')
			.eq('sessionId', sessionId)
			.order('createdAt', { ascending: false });
		if (error) throw new Error(error.message);
		return (data ?? []) as unknown as {
			id: string;
			sessionId: string;
			title: string;
			url: string;
			createdAt: string;
		}[];
	}

	async insertMaterial(sessionId: string, title: string, url: string) {
		const { data, error } = await supabase
			.from('pl_mentorship_material')
			.insert({ sessionId, title, url })
			.select('id, "sessionId", title, url, "createdAt"')
			.single();
		if (error) throw new Error(error.message);
		return data as unknown as {
			id: string;
			sessionId: string;
			title: string;
			url: string;
			createdAt: string;
		};
	}

	async deleteMaterial(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_mentorship_material')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── chat ──────────────────────────────────────────────────────────────────

	async listMessages(sessionId: string, limit = 100) {
		const { data, error } = await supabase
			.from('pl_mentorship_message')
			.select(
				'id, "customerId", content, "createdAt", Customers!inner(id, name, pl_community_profile(image))',
			)
			.eq('sessionId', sessionId)
			.order('createdAt', { ascending: false })
			.limit(limit);
		if (error) throw new Error(error.message);
		// vem do mais novo → inverte p/ ordem cronológica.
		return (data ?? []).reverse().map((row) => {
			// biome-ignore lint/suspicious/noExplicitAny: join aninhado dinâmico
			const r = row as any;
			const customer = r.Customers;
			const profileList = customer?.pl_community_profile;
			const profile = Array.isArray(profileList) ? profileList[0] : profileList;
			return {
				id: r.id as string,
				customerId: r.customerId as string,
				customerName: (customer?.name as string | null) ?? null,
				customerImage: (profile?.image as string | null) ?? null,
				content: r.content as string,
				createdAt: r.createdAt as string,
			};
		});
	}

	async insertMessage(sessionId: string, customerId: string, content: string) {
		const { data, error } = await supabase
			.from('pl_mentorship_message')
			.insert({ sessionId, customerId, content })
			.select('id, "customerId", content, "createdAt"')
			.single();
		if (error) throw new Error(error.message);
		return data as unknown as {
			id: string;
			customerId: string;
			content: string;
			createdAt: string;
		};
	}
}

export const mentorshipRepository = new MentorshipRepository();
