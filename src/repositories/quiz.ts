import { supabase } from '../lib/supabase.js';
import type { CreateQuestion, UpdateQuestion } from '../types/quiz.js';

class QuizRepository {
	async findByLesson(lessonId: string) {
		const { data: quiz, error } = await supabase
			.from('pl_quiz')
			.select('*')
			.eq('lessonId', lessonId)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!quiz) return null;

		const questions = await this.getQuestionsWithOptions(quiz.id);
		return { ...quiz, questions };
	}

	async create(lessonId: string, title: string) {
		const { data: quiz, error } = await supabase
			.from('pl_quiz')
			.insert({
				id: crypto.randomUUID(),
				lessonId,
				title,
				createdAt: new Date().toISOString(),
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return { ...quiz, questions: [] };
	}

	async delete(quizId: string) {
		const { data, error: findError } = await supabase
			.from('pl_quiz')
			.select('id')
			.eq('id', quizId)
			.single();

		if (findError || !data) throw new Error('Quiz not found');

		const { error } = await supabase.from('pl_quiz').delete().eq('id', quizId);
		if (error) throw new Error(error.message);
	}

	async addQuestion(quizId: string, data: CreateQuestion) {
		const { data: quiz, error: quizError } = await supabase
			.from('pl_quiz')
			.select('id')
			.eq('id', quizId)
			.single();

		if (quizError || !quiz) throw new Error('Quiz not found');

		const questionId = crypto.randomUUID();
		const { error: qError } = await supabase.from('pl_quiz_question').insert({
			id: questionId,
			quizId,
			text: data.text,
			order: data.order,
		});

		if (qError) throw new Error(qError.message);

		const options = data.options.map((opt) => ({
			id: crypto.randomUUID(),
			questionId,
			text: opt.text,
			isCorrect: opt.isCorrect,
		}));

		const { error: optError } = await supabase
			.from('pl_quiz_option')
			.insert(options);

		if (optError) throw new Error(optError.message);

		return this.getQuestionWithOptions(questionId);
	}

	async updateQuestion(questionId: string, data: UpdateQuestion) {
		const { data: existing, error: findError } = await supabase
			.from('pl_quiz_question')
			.select('id')
			.eq('id', questionId)
			.single();

		if (findError || !existing) throw new Error('Question not found');

		if (data.text !== undefined || data.order !== undefined) {
			const { error } = await supabase
				.from('pl_quiz_question')
				.update({
					...(data.text !== undefined && { text: data.text }),
					...(data.order !== undefined && { order: data.order }),
				})
				.eq('id', questionId);

			if (error) throw new Error(error.message);
		}

		if (data.options) {
			await supabase
				.from('pl_quiz_option')
				.delete()
				.eq('questionId', questionId);

			const options = data.options.map((opt) => ({
				id: crypto.randomUUID(),
				questionId,
				text: opt.text,
				isCorrect: opt.isCorrect,
			}));

			const { error } = await supabase.from('pl_quiz_option').insert(options);
			if (error) throw new Error(error.message);
		}

		return this.getQuestionWithOptions(questionId);
	}

	async deleteQuestion(questionId: string) {
		const { data, error: findError } = await supabase
			.from('pl_quiz_question')
			.select('id')
			.eq('id', questionId)
			.single();

		if (findError || !data) throw new Error('Question not found');

		const { error } = await supabase
			.from('pl_quiz_question')
			.delete()
			.eq('id', questionId);

		if (error) throw new Error(error.message);
	}

	private async getQuestionsWithOptions(quizId: string) {
		const { data: questions, error } = await supabase
			.from('pl_quiz_question')
			.select('*, pl_quiz_option(*)')
			.eq('quizId', quizId)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);

		return questions.map((q) => ({
			id: q.id,
			text: q.text,
			order: q.order,
			options: q.pl_quiz_option,
		}));
	}

	private async getQuestionWithOptions(questionId: string) {
		const { data, error } = await supabase
			.from('pl_quiz_question')
			.select('*, pl_quiz_option(*)')
			.eq('id', questionId)
			.single();

		if (error) throw new Error(error.message);

		return {
			id: data.id,
			text: data.text,
			order: data.order,
			options: data.pl_quiz_option,
		};
	}
}

export const quizRepository = new QuizRepository();
