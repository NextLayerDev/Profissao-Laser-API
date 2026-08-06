import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Smoke do gate "já é P&B chapado → pula IA" em `aiLineartController`.
 *
 * Testa a nível de LIB (sem HTTP/DB/billing) os dois casos reais que motivaram
 * a mudança: um halftone denso (já 100% preto/branco, não devia ir pra IA) e
 * uma foto colorida de verdade (precisa de IA). Confirma que `analyzeImage`
 * classifica os dois corretamente (fix do kernel 'nearest') e que o SVG gerado
 * sem IA preserva a textura de pontos em vez de virar blobs.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/_smoke-vectorize-ai-gate.ts
 */

const DOWNLOADS = join(homedir(), 'Downloads');
const CASES: {
	slug: string;
	label: string;
	file: string;
	expectSkip: boolean | null;
}[] = [
	{
		slug: 'bmw',
		label: 'BMW (halftone P&B — NÃO devia ir pra IA)',
		file: join(DOWNLOADS, 'resultado (10).png'),
		expectSkip: true,
	},
	{
		slug: 'familia',
		label: 'Família colorida — DEVIA ir pra IA',
		file: join(DOWNLOADS, '5358275d-67e2-4eb9-abf7-8ad62506b438.jpeg'),
		expectSkip: false,
	},
	{
		slug: 'ilustracao-hachura',
		label: 'Ilustração nanquim/hachura já P&B (resultado 11) — teste',
		file: join(DOWNLOADS, 'resultado (11).png'),
		expectSkip: null,
	},
];

const OUT_DIR =
	'/private/tmp/claude-501/-Users-joaocruz-Desktop-nextlayerdev-Profissao-Laser-API/979ae78e-d276-4bce-bcd0-5e3104d6d8b4/scratchpad';

async function main() {
	// Filtro opcional por slug (evita rechamar a IA/os casos já validados):
	//   npx tsx --env-file=.env scripts/_smoke-vectorize-ai-gate.ts ilustracao-hachura
	const filterSlugs = process.argv.slice(2);
	const cases = filterSlugs.length
		? CASES.filter((c) => filterSlugs.includes(c.slug))
		: CASES;

	const { readFile } = await import('node:fs/promises');
	const { analyzeImage } = await import('../src/lib/vectorize-analyze.js');
	const { classifyImage } = await import('../src/lib/image-classify.js');
	const { redrawAsNanquim } = await import('../src/lib/ai-lineart.js');
	const { vectorizeImage, parseVectorizeParams } = await import(
		'../src/lib/vectorize.js'
	);

	for (const c of cases) {
		console.log(`\n=== ${c.label} ===`);
		const buffer = await readFile(c.file);
		const meta = await import('sharp').then((s) =>
			s.default(buffer).metadata(),
		);
		console.log(`arquivo: ${c.file} (${meta.width}x${meta.height})`);

		const profile = await analyzeImage(buffer);
		console.log('analyzeImage:', {
			class: profile.class,
			recommendTool: profile.recommendTool,
			bimodality: profile.metrics.bimodality.toFixed(3),
			grayEntropy: profile.metrics.grayEntropy.toFixed(3),
			otsuThreshold: profile.metrics.otsuThreshold,
			colorCount: profile.metrics.colorCount,
			saturation: profile.metrics.saturation.toFixed(3),
			edgeDensity: profile.metrics.edgeDensity.toFixed(3),
			noise: profile.metrics.noise.toFixed(3),
			foregroundRatio: profile.metrics.foregroundRatio.toFixed(3),
		});
		console.log('recommendedParams:', profile.recommendedParams);

		// Mesma condição do gate novo em aiLineartController.
		const alreadyFlatBW =
			profile.class === 'text' ||
			profile.class === 'line_art' ||
			profile.class === 'logo';
		const willSkipAi = alreadyFlatBW;
		const verdict =
			c.expectSkip === null
				? 'sem expectativa fixada'
				: willSkipAi === c.expectSkip
					? 'OK'
					: 'DIVERGIU';
		console.log(
			`gate: willSkipAi=${willSkipAi} (esperado=${c.expectSkip}) → ${verdict}`,
		);

		const base = c.slug;

		if (willSkipAi) {
			// Caminho sem IA: vetorização tradicional direta com os params recomendados.
			const recommended = Object.fromEntries(
				Object.entries(profile.recommendedParams)
					.filter(([, v]) => v !== null && v !== undefined)
					.map(([k, v]) => [k, String(v)]),
			);
			const params = parseVectorizeParams({ ...recommended, subject: 'logo' });
			const t0 = Date.now();
			const svg = await vectorizeImage(buffer, params);
			console.log(
				`vetorização direta (sem IA): ${Date.now() - t0}ms, ${svg.length} bytes SVG`,
			);
			await writeFile(join(OUT_DIR, `${base}-no-ai.svg`), svg);
			console.log(`salvo em ${join(OUT_DIR, `${base}-no-ai.svg`)}`);
		} else {
			// Caminho com IA: classifica prompt (foto/logo) + redesenha + traça.
			const detected = await classifyImage(buffer);
			console.log(
				'classifyImage (prompt):',
				detected.kind,
				detected.confidence,
			);
			const t0 = Date.now();
			const outcome = await redrawAsNanquim(buffer, detected.kind);
			console.log(
				`redrawAsNanquim: ${Date.now() - t0}ms, sucesso=${!!outcome.png}, failures=${outcome.failures.join(',') || 'nenhuma'}`,
			);
			if (outcome.png) {
				const params = parseVectorizeParams({
					mode: 'trace',
					edgeDetection: 'none',
					turdSize: '3',
					subject: detected.kind,
				});
				const svg = await vectorizeImage(outcome.png, params);
				await writeFile(join(OUT_DIR, `${base}-with-ai.svg`), svg);
				await writeFile(join(OUT_DIR, `${base}-ai-redraw.png`), outcome.png);
				console.log(`salvo em ${join(OUT_DIR, `${base}-with-ai.svg`)}`);
			}
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
