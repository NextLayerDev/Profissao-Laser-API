import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function registerRoutes(server: FastifyInstance) {
	const routesDir = __dirname;
	const folders = readdirSync(routesDir, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);

	const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';

	for (const folder of folders) {
		const routeFile = `${folder}${extension}`;
		const routePath = join(routesDir, folder, routeFile);

		try {
			const routeUrl = pathToFileURL(routePath).href;
			const routeModule = await import(routeUrl);

			if (typeof routeModule.default === 'function') {
				server.register(routeModule.default, { prefix: `/api/${folder}` });
				server.log.info(`Registered routes from: ${folder}/${routeFile}`);
			}
		} catch (error) {
			console.log(error);
			server.log.error(
				`Failed to register routes from ${folder}/${routeFile}:`,
			);
		}
	}
}
