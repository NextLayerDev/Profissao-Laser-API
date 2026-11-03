/**
 * Smoke do bloco `ai.vision` — foto real → ficha estruturada.
 *
 * Verifica as três coisas que só aparecem chamando o modelo de verdade:
 *   1. o conteúdo multimodal é aceito pelo OpenRouter (território novo no repo);
 *   2. o downscale entrega a economia prometida (é a maior alavanca de custo);
 *   3. a ficha volta em FAIXA, e não em número único — que é a regra de
 *      honestidade do produto.
 *
 *   npx tsx scripts/_smoke-ai-vision.ts [caminho-da-foto]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { aiVisionBlock } from '../src/tool-blocks/blocks/ai-vision.js';

const FOTO =
	process.argv[2] ??
	'/Users/joaocruz/Desktop/nextlayerdev/profissao_laser/public/img/copo-stanley-copy-min.jpg';

const SYSTEM = [
	'Você é o Perito de Produto de uma escola de corte e gravação a laser.',
	'Olha a foto e identifica o produto para uma análise de custo e de mercado.',
	'NUNCA dê número único para dimensão: sempre {min, prov, max}.',
	'Se não der para saber pela foto, use null e diga o que falta.',
	'Responda só JSON.',
].join(' ');

const USER = [
	'Analise o produto. JSON com este formato:',
	'{produto, material_provavel, processo:["corte"|"gravacao"|"marcacao"],',
	'bbox_mm:{w_min,w_prov,w_max,h_min,h_prov,h_max}, n_furos,',
	'complexidade:"simples|media|alta", tem_gravacao, espessura_mm_provavel,',
	'confianca, o_que_falta:[]}',
].join(' ');

async function main() {
	const buf = readFileSync(FOTO);
	const meta = await sharp(buf).metadata();
	const menor = await sharp(buf)
		.rotate()
		.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 80 })
		.toBuffer();

	console.log(`foto     : ${FOTO.split('/').pop()}`);
	console.log(
		`original : ${meta.width}×${meta.height}, ${(buf.byteLength / 1024).toFixed(0)} KB`,
	);
	console.log(
		`reduzida : 1024 máx, ${(menor.byteLength / 1024).toFixed(0)} KB  ` +
			`(${(buf.byteLength / menor.byteLength).toFixed(1)}× menor)`,
	);

	const t0 = Date.now();
	const out = await aiVisionBlock.run(
		{ customerId: 'smoke', onProgress: (e) => console.log('   ·', e.kind) },
		{
			image: buf,
			fallback: '',
			system: SYSTEM,
			user: USER,
			model: 'google/gemini-3.1-flash-lite',
			max_side: 1024,
			max_tokens: 900,
			temperature: 0.1,
		},
	);

	console.log(`\nmodelo   : ${out.model}   (${Date.now() - t0} ms)`);
	console.log(JSON.stringify(out.json, null, 1).slice(0, 1400));

	// A regra que o produto inteiro depende: faixa, não número único.
	const j = out.json as { bbox_mm?: Record<string, unknown> };
	const b = j?.bbox_mm ?? {};
	const temFaixa = b.w_min !== undefined && b.w_max !== undefined;
	console.log(
		`\nfaixa em vez de número único: ${temFaixa ? 'OK' : 'FALHOU — o prompt precisa insistir mais'}`,
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
