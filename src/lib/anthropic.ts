import Anthropic from '@anthropic-ai/sdk';

/**
 * Cliente Anthropic (Claude) — espelha `lib/openrouter.ts`. Usado pelo Agente
 * "Tool Engineer" (tool-use nativo + streaming + prompt caching). A chave vem do
 * ambiente; o modelo é env-configurável (padrão Sonnet 4.6, bom custo/qualidade).
 */
export const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY || 'not-configured',
});

export const AGENT_MODEL = process.env.TOOL_AGENT_MODEL || 'claude-sonnet-4-6';
