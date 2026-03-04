import { supabase } from '../lib/supabase.js';

class DoubtRepository {
	async listByLesson(lessonId: string) {
		const { data, error } = await supabase
			.from('pl_lesson_doubt')
			.select(`
				id,
				content,
				created_at,
				customer_id,
				pl_lesson_doubt_reply (
					id,
					content,
					author_name,
					created_at
				)
			`)
			.eq('lesson_id', lessonId)
			.order('created_at', { ascending: true });

		if (error) throw new Error(error.message);

		const rows = data ?? [];

		const customerIds = [
			...new Set(rows.map((r) => r.customer_id).filter(Boolean)),
		];

		const customerMap: Record<string, string> = {};
		if (customerIds.length > 0) {
			const { data: customers } = await supabase
				.from('Customers')
				.select('id, name')
				.in('id', customerIds);
			for (const c of customers ?? []) {
				customerMap[c.id] = c.name;
			}
		}

		return rows.map((row) => ({
			id: row.id,
			content: row.content,
			authorName: customerMap[row.customer_id] ?? 'Aluno',
			createdAt: row.created_at,
			replies: (row.pl_lesson_doubt_reply ?? []).map(
				(reply: {
					id: string;
					content: string;
					author_name: string;
					created_at: string;
				}) => ({
					id: reply.id,
					content: reply.content,
					authorName: reply.author_name,
					createdAt: reply.created_at,
					isInstructor: true as const,
				}),
			),
		}));
	}

	async create(lessonId: string, customerId: string, content: string) {
		const { data, error } = await supabase
			.from('pl_lesson_doubt')
			.insert({
				lesson_id: lessonId,
				customer_id: customerId,
				content,
			})
			.select('id, content, created_at')
			.single();

		if (error) throw new Error(error.message);

		const { data: customer } = await supabase
			.from('Customers')
			.select('name')
			.eq('id', customerId)
			.maybeSingle();

		return {
			id: data.id,
			content: data.content,
			authorName: customer?.name ?? 'Aluno',
			createdAt: data.created_at,
			replies: [] as never[],
		};
	}

	async addReply(
		doubtId: string,
		userId: string,
		userName: string,
		content: string,
	) {
		const { data, error } = await supabase
			.from('pl_lesson_doubt_reply')
			.insert({
				doubt_id: doubtId,
				user_id: userId,
				author_name: userName,
				content,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);

		return {
			id: data.id,
			content: data.content,
			authorName: data.author_name,
			createdAt: data.created_at,
			isInstructor: true as const,
		};
	}
}

export const doubtRepository = new DoubtRepository();
