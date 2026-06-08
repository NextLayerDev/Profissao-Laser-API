import OpenAI from 'openai';

export const openrouter = new OpenAI({
	baseURL: 'https://openrouter.ai/api/v1',
	apiKey: process.env.OPENROUTER_API_KEY || 'not-configured',
});

export const PREVIA_MODEL = 'google/gemini-3-pro-image-preview';

export interface GeminiImageMessage {
	role: string;
	content: string;
	images?: Array<{
		type: string;
		image_url:
			| {
					url: string;
			  }
			| string;
		index: number;
	}>;
}
