import { delKey, incrWithTtl } from '../../lib/redis.js';
import { captureException } from '../../lib/sentry.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import { omniMessageRepository } from '../../repositories/omni-message.js';
import { omniTurnRepository } from '../../repositories/omni-turn.js';
import type { OmniInstance } from '../../types/omni.js';

/**
 * Debounce + locks do motor de IA. O buffer canônico é o DB
 * (pl_omni_message.ai_state='pending'); timers in-process disparam o turno e a
 * VARREDURA (30s) cobre restart/timer perdido. Locks em duas camadas:
 *   1. Redis SET NX EX 180 (rápido; fail-open — sem Redis segue pro DB)
 *   2. pl_omni_turn partial unique (status='running') — garantia real
 * Nova mensagem RESETA a janela (debounce_seconds), com teto de 20s a partir
 * da 1ª pendente (anti-starvation em cliente que digita sem parar).
 * Design assume 1 réplica de API (EasyPanel) — se escalar, mover os timers
 * pra um worker com ZSET no Redis (estrutura já isola em schedule/run).
 */

const MAX_WINDOW_MS = 20_000;
const SWEEP_INTERVAL_MS = 30_000;
const STALE_PENDING_MS = 15_000;
const STALE_RUNNING_MS = 5 * 60_000;
const REDIS_LOCK_TTL_S = 180;

type RunTurnFn = (
	instance: OmniInstance,
	chatId: string,
	turnId: string,
	inputMessageIds: string[],
) => Promise<void>;

class OmniDebounce {
	private timers = new Map<string, NodeJS.Timeout>();
	private sweepTimer: NodeJS.Timeout | null = null;
	/** Injetado pelo pipeline (evita import circular). */
	private runTurn: RunTurnFn | null = null;

	setRunner(fn: RunTurnFn): void {
		this.runTurn = fn;
	}

	schedule(instance: OmniInstance, chatId: string): void {
		const existing = this.timers.get(chatId);
		if (existing) clearTimeout(existing);
		void this.computeDelayAndArm(instance, chatId);
	}

	private async computeDelayAndArm(
		instance: OmniInstance,
		chatId: string,
	): Promise<void> {
		let wait = (instance.debounce_seconds || 8) * 1000;
		try {
			const age = await omniMessageRepository.oldestPendingAgeMs(chatId);
			if (age > 0) wait = Math.min(wait, Math.max(500, MAX_WINDOW_MS - age));
		} catch {
			// mantém a janela padrão
		}
		const t = setTimeout(() => {
			this.timers.delete(chatId);
			void this.runGuarded(instance.id, chatId);
		}, wait);
		this.timers.set(chatId, t);
	}

	/** Lock duplo + turno. Reagenda se sobrar pendência (msg durante o turno). */
	async runGuarded(instanceId: string, chatId: string): Promise<void> {
		const runner = this.runTurn;
		if (!runner) return;
		const lockKey = `omni:lock:${chatId}`;

		// camada 1: Redis (fail-open — cacheAside noop devolve o valor do loader,
		// então usamos tryLock dedicado; se não houver Redis, cai direto pro DB)
		const gotRedis = await this.tryRedisLock(lockKey);
		if (gotRedis === false) {
			// ocupado — re-tenta em 5s (o turno atual reagenda no fim tb)
			setTimeout(() => void this.runGuarded(instanceId, chatId), 5_000);
			return;
		}

		try {
			const pending = await omniMessageRepository.listPending(chatId);
			if (pending.length === 0) return;

			const instance = await omniInstanceRepository.findById(instanceId);
			if (!instance || !instance.ia_enabled) return;
			if (instance.billing_status !== 'ok') {
				await omniMessageRepository.markSkipped(pending.map((m) => m.id));
				return;
			}

			// camada 2: lock de DB (partial unique running)
			const turn = await omniTurnRepository.tryStart(
				chatId,
				instanceId,
				pending.map((m) => m.id),
			);
			if (!turn) return; // outro turno ativo

			try {
				await runner(
					instance,
					chatId,
					turn.id,
					pending.map((m) => m.id),
				);
			} catch (err) {
				captureException(err as Error);
				await omniTurnRepository
					.finish(turn.id, 'failed', { error: String(err).slice(0, 800) })
					.catch(() => {});
			}
		} finally {
			await this.releaseRedisLock(lockKey);
		}

		// chegou mensagem durante o turno → nova janela
		try {
			if (await omniMessageRepository.hasPending(chatId)) {
				const instance = await omniInstanceRepository.findById(instanceId);
				if (instance) this.schedule(instance, chatId);
			}
		} catch {
			// varredura cobre
		}
	}

	private async tryRedisLock(key: string): Promise<boolean | 'noredis'> {
		// Lock via INCR+TTL: 1º incr da janela == 1 → lock nosso; >1 → ocupado;
		// -1 = sem Redis (fail-open → o lock de DB do pl_omni_turn segura sozinho).
		const n = await incrWithTtl(key, REDIS_LOCK_TTL_S);
		if (n === -1) return 'noredis';
		return n === 1;
	}

	private async releaseRedisLock(key: string): Promise<void> {
		await delKey(key);
	}

	/** Varredura: pendências velhas sem turno + turnos órfãos. Iniciar no boot. */
	startSweep(): void {
		if (this.sweepTimer) return;
		const sweep = async () => {
			try {
				const stale =
					await omniTurnRepository.listStaleRunning(STALE_RUNNING_MS);
				for (const t of stale) {
					await omniTurnRepository
						.finish(t.id, 'failed', { error: 'turno órfão (crash recovery)' })
						.catch(() => {});
				}
				const chatIds =
					await omniChatRepository.listChatsWithStalePending(STALE_PENDING_MS);
				for (const chatId of chatIds) {
					if (this.timers.has(chatId)) continue;
					const chat = await omniChatRepository.findById(chatId);
					if (!chat) continue;
					const instance = await omniInstanceRepository.findById(
						chat.instance_id,
					);
					if (!instance) continue;
					void this.runGuarded(instance.id, chatId);
				}
			} catch (err) {
				console.error('[omni-debounce] varredura falhou:', err);
			}
		};
		this.sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
		this.sweepTimer.unref?.();
		void sweep();
	}
}

export const omniDebounce = new OmniDebounce();
