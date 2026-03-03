import { supabase } from '../lib/supabase.js';

class DoubtRepository {
	async listByLesson(lessonId: string) {
		const { data, error } = await supabase
			.from('pl_lesson_doubt')
			.select(`
				id,
				content,
				created_at,
				pl_customer!customer_id (
					name
				),
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

		return (data ?? []).map(
			(row: {
				id: string;
				content: string;
				created_at: string;
				pl_customer: { name: string } | { name: string }[] | null;
				pl_lesson_doubt_reply: {
					id: string;
					content: string;
					author_name: string;
					created_at: string;
				}[];
			}) => {
				const customer = Array.isArray(row.pl_customer)
					? row.pl_customer[0]
					: row.pl_customer;
				return {
					id: row.id,
					content: row.content,
					authorName: customer?.name ?? 'Aluno',
					createdAt: row.created_at,
					replies: (row.pl_lesson_doubt_reply ?? []).map((reply) => ({
						id: reply.id,
						content: reply.content,
						authorName: reply.author_name,
						createdAt: reply.created_at,
						isInstructor: true as const,
					})),
				};
			},
		);
	}

	async create(lessonId: string, customerId: string, content: string) {
		const { data, error } = await supabase
			.from('pl_lesson_doubt')
			.insert({
				lesson_id: lessonId,
				customer_id: customerId,
				content,
			})
			.select(`
				id,
				content,
				created_at,
				pl_customer!customer_id (
					name
				)
			`)
			.single();

		if (error) throw new Error(error.message);

		const customer = Array.isArray(data.pl_customer)
			? data.pl_customer[0]
			: data.pl_customer;

		return {
			id: data.id,
			content: data.content,
			authorName: (customer as { name: string } | null)?.name ?? 'Aluno',
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
