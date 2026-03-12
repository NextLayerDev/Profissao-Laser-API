import { supabase } from '../lib/supabase.js';
import type { CreateFaq, UpdateFaq } from '../types/faq.js';

type FaqRow = {
	id: string;
	question: string;
	answer: string;
	image_url: string | null;
	order: number;
	created_at: string;
	updated_at: string;
};

type ReactionRow = {
	id: string;
	faq_id: string;
	user_id: string;
	emoji: string;
	created_at: string;
};

function aggregateReactions(
	reactions: ReactionRow[],
	userId: string,
): {
	reactions: { emoji: string; count: number }[];
	userReaction: string | null;
} {
	const counts: Record<string, number> = {};
	let userReaction: string | null = null;

	for (const r of reactions) {
		counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
		if (r.user_id === userId) {
			userReaction = r.emoji;
		}
	}

	const reactionList = Object.entries(counts).map(([emoji, count]) => ({
		emoji,
		count,
	}));

	return { reactions: reactionList, userReaction };
}

class FaqRepository {
	async findAll(userId: string) {
		const { data: faqs, error: faqError } = await supabase
			.from('faqs')
			.select('*')
			.order('order', { ascending: true });

		if (faqError) throw new Error(faqError.message);

		const { data: allReactions, error: reactionError } = await supabase
			.from('faq_reactions')
			.select('*');

		if (reactionError) throw new Error(reactionError.message);

		return (faqs as FaqRow[]).map((faq) => {
			const faqReactions = (allReactions as ReactionRow[]).filter(
				(r) => r.faq_id === faq.id,
			);
			const { reactions, userReaction } = aggregateReactions(
				faqReactions,
				userId,
			);
			return { ...faq, reactions, userReaction };
		});
	}

	async findOne(id: string, userId: string) {
		const { data: faq, error: faqError } = await supabase
			.from('faqs')
			.select('*')
			.eq('id', id)
			.single();

		if (faqError) throw new Error(faqError.message);

		const { data: faqReactions, error: reactionError } = await supabase
			.from('faq_reactions')
			.select('*')
			.eq('faq_id', id);

		if (reactionError) throw new Error(reactionError.message);

		const { reactions, userReaction } = aggregateReactions(
			faqReactions as ReactionRow[],
			userId,
		);
		return { ...(faq as FaqRow), reactions, userReaction };
	}

	async create(data: CreateFaq) {
		const { data: faq, error } = await supabase
			.from('faqs')
			.insert({
				question: data.question,
				answer: data.answer,
				image_url: data.imageUrl ?? null,
				order: data.order,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return { ...(faq as FaqRow), reactions: [], userReaction: null };
	}

	async update(id: string, data: UpdateFaq, userId: string) {
		const updatePayload: Record<string, unknown> = {};
		if (data.question !== undefined) updatePayload.question = data.question;
		if (data.answer !== undefined) updatePayload.answer = data.answer;
		if (data.imageUrl !== undefined) updatePayload.image_url = data.imageUrl;
		if (data.order !== undefined) updatePayload.order = data.order;
		updatePayload.updated_at = new Date().toISOString();

		const { error } = await supabase
			.from('faqs')
			.update(updatePayload)
			.eq('id', id);

		if (error) throw new Error(error.message);
		return this.findOne(id, userId);
	}

	async remove(id: string) {
		const { error } = await supabase.from('faqs').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async reorder(ids: string[]) {
		await Promise.all(
			ids.map((id, index) =>
				supabase
					.from('faqs')
					.update({ order: index, updated_at: new Date().toISOString() })
					.eq('id', id),
			),
		);
	}

	async upsertReaction(faqId: string, userId: string, emoji: string) {
		const { data: existing } = await supabase
			.from('faq_reactions')
			.select('*')
			.eq('faq_id', faqId)
			.eq('user_id', userId)
			.maybeSingle();

		if (!existing) {
			const { error } = await supabase
				.from('faq_reactions')
				.insert({ faq_id: faqId, user_id: userId, emoji });
			if (error) throw new Error(error.message);
		} else if (existing.emoji === emoji) {
			const { error } = await supabase
				.from('faq_reactions')
				.delete()
				.eq('faq_id', faqId)
				.eq('user_id', userId);
			if (error) throw new Error(error.message);
		} else {
			const { error } = await supabase
				.from('faq_reactions')
				.update({ emoji })
				.eq('faq_id', faqId)
				.eq('user_id', userId);
			if (error) throw new Error(error.message);
		}

		return this.findOne(faqId, userId);
	}

	async removeReaction(faqId: string, userId: string) {
		const { error } = await supabase
			.from('faq_reactions')
			.delete()
			.eq('faq_id', faqId)
			.eq('user_id', userId);
		if (error) throw new Error(error.message);
		return this.findOne(faqId, userId);
	}
}

export const faqRepository = new FaqRepository();
