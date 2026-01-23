import { fastifyCors } from '@fastify/cors';
import { fastifyJwt } from '@fastify/jwt';
import { fastifySwagger } from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';
import { fastify } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';

import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { routes } from './routes/index.js';

export const app = fastify().withTypeProvider<ZodTypeProvider>();

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

app.get('/openapi.json', (_, reply) => {
	reply.send(app.swagger());
});

app.register(ScalarApiReference, {
	routePrefix: '/docs',
	configuration: {
		spec: {
			url: '/openapi.json',
		},
	},
});

app.register(routes);

const PORT = process.env.PORT || 3333;

app.listen({ port: Number(PORT), host: '0.0.0.0' }).then((address) => {
	console.log(`HTTP server running on ${address}`);
	console.log(`Docs available at ${address}/docs`);
});

export default app;
