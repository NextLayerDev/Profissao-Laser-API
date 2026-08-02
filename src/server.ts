import { fastifyCors } from '@fastify/cors';
import multipart from '@fastify/multipart';
import { fastifySwagger } from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';
import { type FastifyError, fastify } from 'fastify';
import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { captureException, initSentry } from './lib/sentry.js';
import { routes } from './router.js';

initSentry();

/**
 * `TRUST_PROXY` decide se `request.ip` pode vir de `x-forwarded-for`.
 *
 * PRECISA SER DECIDIDO NO DEPLOY, e é o link público de orçamento
 * (`routes/public-quote.ts`) que introduz a consequência:
 *
 *   • DESLIGADO atrás de um reverse proxy → `request.ip` é o IP DO PROXY para
 *     todo mundo. O teto por IP (6/h) deixa de ser "por visitante" e vira um
 *     teto GLOBAL do endpoint: o sétimo orçamento da hora, de qualquer pessoa
 *     em qualquer link, leva 429. A feature não funciona.
 *
 *   • LIGADO sem proxy na frente → qualquer cliente escreve o próprio
 *     `x-forwarded-for` e o teto por IP vira enfeite.
 *
 * Por isso o default é DESLIGADO (o comportamento de hoje, sem mudança) e o
 * valor é explícito: `true`/`1` confia no primeiro salto, um número confia em N
 * saltos, e um IP/CIDR confia só naquele proxy — que é a forma correta.
 * Nenhuma outra rota deste app lê `request.ip`.
 */
function trustProxy(): boolean | number | string {
	const v = process.env.TRUST_PROXY?.trim();
	if (!v || v === 'false' || v === '0') return false;
	if (v === 'true') return true;
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : v;
}

const app = fastify({
	trustProxy: trustProxy(),
}).withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(multipart, { limits: { fileSize: 1500 * 1024 * 1024 } }); // 1.5 gb

app.register(fastifyCors, {
	origin: true,
	methods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

app.setErrorHandler((error: FastifyError, _request, reply) => {
	captureException(error);
	reply.status(error.statusCode ?? 500).send({ message: error.message });
});

app.register(fastifySwagger, {
	openapi: {
		info: {
			title: 'Profissão Laser API',
			description: 'API to manage products, orders, and users',
			version: '1.0.0',
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
				},
			},
		},
	},
	transform: jsonSchemaTransform,
});

app.register(ScalarApiReference, {
	routePrefix: '/docs',
});

app.decorateRequest('currentUser', null);

app.get('/test-sentry', () => {
	throw new Error('Sentry test from VPS');
});

app.register(routes);

app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
	console.log('HTTP server running on http://localhost:3333!');
	console.log('Docs available at http://localhost:3333/docs');
});
