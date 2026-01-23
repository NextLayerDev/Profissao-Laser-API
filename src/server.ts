import { fastifyCors } from '@fastify/cors';
import { fastifyJwt } from '@fastify/jwt';
import { fastifySwagger } from '@fastify/swagger';
import { fastify } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';

import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { routes } from './routes/index';

const app = fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(fastifyRawBody, {
	field: 'rawBody',
	global: false,
	encoding: 'utf8',
	runFirst: true,
	routes: [],
});

app.register(fastifyCors, {
	origin: true,
	methods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

if (!process.env.JWT_SECRET) {
	throw new Error('JWT_SECRET is not defined in .env');
}

app.register(fastifyJwt, {
	secret: process.env.JWT_SECRET,
});

app.register(fastifySwagger, {
	openapi: {
		info: {
			title: 'Profissão Laser API',
			description: '',
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

app.register(async (instance) => {
	const ScalarApiReference = await import('@scalar/fastify-api-reference');
	await instance.register(ScalarApiReference.default, {
		routePrefix: '/docs',
	});
});

app.register(routes);

app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
	console.log('HTTP server running on http://localhost:3333!');
	console.log('Docs available at http://localhost:3333/docs');
});
