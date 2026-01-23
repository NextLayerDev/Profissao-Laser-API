import 'dotenv/config';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { fastifySwagger } from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';
import Fastify, { type FastifyError } from 'fastify';
import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import registerRoutes from './routes/index.js';

const startServer = async () => {
	try {
		const server = Fastify({
			logger: false,
		}).withTypeProvider<ZodTypeProvider>();

		server.setErrorHandler((error: FastifyError, request, reply) => {
			reply
				.header('Access-Control-Allow-Origin', request.headers.origin || '*')
				.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
				.header(
					'Access-Control-Allow-Methods',
					'GET, POST, PUT, PATCH, DELETE, OPTIONS',
				)
				.status(error.statusCode ?? 500)
				.send({
					message: error.message,
				});
		});

		server.setValidatorCompiler(validatorCompiler);
		server.setSerializerCompiler(serializerCompiler);

		await server.register(cors, {
			origin: '*',
		});

		await server.register(multipart);

		server.register(fastifySwagger, {
			openapi: {
				info: {
					title: 'Profissão Lase API',
					description: 'API documentation',
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
				security: [
					{
						bearerAuth: [],
					},
				],
			},
			transform: jsonSchemaTransform,
		});

		server.get('/openapi.json', (_, reply) => {
			reply.send(server.swagger());
		});

		await server.register(ScalarApiReference, {
			routePrefix: '/docs',
			configuration: {
				spec: {
					url: '/openapi.json',
				},
			},
		});

		server.decorateRequest('dataSources', null);

		server.get('/api', async (_, __) => {
			return { status: 'ok' };
		});

		await registerRoutes(server);

		const PORT = process.env.PORT || 4000;
		const address = await server.listen({
			port: Number(PORT),
			host: '0.0.0.0',
		});
		console.log(`🚀 Server ready at: ${address}`);
		return address;
	} catch (err) {
		console.error('Failed to start server:', err);
		process.exit(1);
	}
};

startServer();
