import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { fetchExternalUser, isStaffRole } from '../external-auth.js';

/**
 * Socket realtime do OmniResposta (socket.io, path /omni/socket). Rooms por
 * instância (`instance:{id}`); auth no handshake com o MESMO Bearer do axios
 * (staff/admin only — a permissão fina `omniresposta.view` é gateada nas rotas
 * REST e na página; o socket só transporta eventos de UI). socket.io degrada
 * pra long-polling se o proxy não fizer upgrade; o front ainda tem fallback de
 * polling via React Query se nem isso conectar.
 */

let io: Server | null = null;

export function initOmniSocket(server: HttpServer): void {
	io = new Server(server, {
		path: '/omni/socket',
		cors: { origin: true, methods: ['GET', 'POST'] },
	});

	io.use(async (socket, next) => {
		try {
			const token = String(socket.handshake.auth?.token ?? '');
			if (!token) return next(new Error('unauthorized'));
			const user = await fetchExternalUser(token);
			if (!user || user.blocked || !isStaffRole(user.role)) {
				return next(new Error('unauthorized'));
			}
			socket.data.userId = user.id;
			socket.data.role = user.role;
			next();
		} catch {
			next(new Error('unauthorized'));
		}
	});

	io.on('connection', (socket) => {
		socket.on('join-instance', (payload: { instanceId?: string }) => {
			const id = String(payload?.instanceId ?? '');
			if (id) socket.join(`instance:${id}`);
		});
		socket.on('leave-instance', (payload: { instanceId?: string }) => {
			const id = String(payload?.instanceId ?? '');
			if (id) socket.leave(`instance:${id}`);
		});
	});

	console.log('OmniResposta socket pronto em /omni/socket');
}

/** Emite pra todos os clientes da instância. No-op se socket não inicializado. */
export function emitOmni(
	instanceId: string,
	event: string,
	payload: unknown,
): void {
	try {
		io?.to(`instance:${instanceId}`).emit(event, payload);
	} catch (err) {
		console.error('[omni-socket] emit falhou:', err);
	}
}
