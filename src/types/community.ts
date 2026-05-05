import { z } from 'zod';

export const communityPostSchema = z.object({
	id: z.string(),
	author: z.string(),
	avatar: z.string().nullable(),
	time: z.string(),
	content: z.string(),
	image: z.string().nullable().optional(),
	likes: z.number(),
	comments: z.number(),
	shares: z.number(),
	liked: z.boolean(),
});

export const createPostSchema = z.object({
	content: z.string().min(1),
	image: z.string().optional(),
});

export const communityChannelSchema = z.object({
	id: z.string(),
	label: z.string(),
	description: z.string().nullable().optional(),
	category: z.string(),
	adminOnly: z.boolean(),
	adminView: z.boolean(),
	order: z.number().int(),
});

export const createChannelSchema = z.object({
	name: z.string().min(1),
	adminOnly: z.boolean().optional(),
	adminView: z.boolean().optional(),
	order: z.number().int().optional(),
});

export const updateChannelSchema = z.object({
	name: z.string().min(1).optional(),
	description: z.string().optional(),
	adminOnly: z.boolean().optional(),
	adminView: z.boolean().optional(),
	order: z.number().int().optional(),
});

export const communityMessageSchema = z.object({
	id: z.string(),
	user: z.string(),
	avatar: z.string().nullable(),
	content: z.string(),
	time: z.string(),
	isMe: z.boolean(),
	fileUrl: z.string().nullable().optional(),
});

export const sendMessageSchema = z.object({
	content: z.string().optional(),
});

export const communityMemberSchema = z.object({
	name: z.string(),
	specialty: z.string().nullable(),
	badges: z.array(z.string()),
	category: z.string().nullable(),
	image: z.string().nullable().optional(),
});

export const communityProjectSchema = z.object({
	id: z.string(),
	title: z.string(),
	author: z.string(),
	img: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	material: z.string().nullable().optional(),
	technique: z.string().nullable().optional(),
	time: z.string(),
	likes: z.number(),
	comments: z.number(),
});

export const createProjectSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	author: z.string().min(1),
	img: z.string().optional(),
	material: z.string().optional(),
	technique: z.string().optional(),
});

export const updateProjectSchema = z.object({
	title: z.string().min(1).optional(),
	description: z.string().optional(),
	img: z.string().optional(),
	material: z.string().optional(),
	technique: z.string().optional(),
});

export const postCommentSchema = z.object({
	id: z.string(),
	postId: z.string(),
	author: z.string(),
	content: z.string(),
	time: z.string(),
	isAdmin: z.boolean(),
});

export const projectCommentSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	author: z.string(),
	content: z.string(),
	time: z.string(),
	isAdmin: z.boolean(),
});

export const createCommentSchema = z.object({
	content: z.string().min(1),
});

export const projectDetailSchema = communityProjectSchema.extend({
	commentList: z.array(projectCommentSchema),
});

export const communityEventSchema = z.object({
	id: z.string(),
	title: z.string(),
	date: z.string(),
	time: z.string().nullable().optional(),
	type: z.enum(['workshop', 'live', 'qa']),
	description: z.string().nullable().optional(),
});

export const communityRankingEntrySchema = z.object({
	pos: z.number(),
	name: z.string(),
	pts: z.number(),
});

export const communityRankingSchema = z.object({
	top: z.array(communityRankingEntrySchema),
	rest: z.array(communityRankingEntrySchema),
});

export const createEventSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	date: z.string().min(1),
	time: z.string().optional(),
	type: z.enum(['workshop', 'live', 'qa']),
});

export const updateEventSchema = z.object({
	title: z.string().min(1).optional(),
	description: z.string().optional(),
	date: z.string().optional(),
	time: z.string().optional(),
	type: z.enum(['workshop', 'live', 'qa']).optional(),
});

export type CreatePost = z.infer<typeof createPostSchema>;
export type CreateChannel = z.infer<typeof createChannelSchema>;
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type CreateComment = z.infer<typeof createCommentSchema>;
export type PostComment = z.infer<typeof postCommentSchema>;
export type CreateEvent = z.infer<typeof createEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;

// ─── Activity feed ────────────────────────────────────────────────────────────

export const activityTypeEnum = z.enum([
	'lesson_completed',
	'badge_earned',
	'forum_post',
	'forum_reply',
	'challenge_completed',
	'opportunity_created',
	'member_joined',
]);

export const activitySchema = z.object({
	id: z.string(),
	type: activityTypeEnum,
	user: z.object({
		id: z.string(),
		name: z.string(),
		avatar: z.string().nullable(),
	}),
	data: z.record(z.string(), z.unknown()),
	createdAt: z.string(),
});
