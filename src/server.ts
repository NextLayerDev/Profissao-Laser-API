import { fastifyCors } from '@fastify/cors';
import { fastifyJwt } from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { fastifySwagger } from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';
import { fastify } from 'fastify';
import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { routes } from './router.js';

const app = fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(multipart, { limits: { fileSize: 1000 * 1024 * 1024 } }); // 1 gb

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

app.register(routes);

app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
	console.log('HTTP server running on http://localhost:3333!');
	console.log('Docs available at http://localhost:3333/docs');
});
