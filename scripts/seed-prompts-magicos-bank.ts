/**
 * Seed do "Banco do Admin" da tool Prompts Mágicos (gravação a laser).
 *
 * Pra cada registro: gera uma CAPA de exemplo (Gemini Image, via
 * `generateToolImage` — NÃO passa pela cobrança, então não consome voxxys),
 * sobe pro Bunny CDN (`uploadToolOutput`) e insere em `pl_tool_bank_entry`
 * (Demo_DB). Idempotente por `title` (pula o que já existe; não toca o
 * "Vetor Logo"). Se a geração da capa falhar, insere o registro sem capa.
 *
 * Uso: npx tsx --env-file=.env scripts/seed-prompts-magicos-bank.ts
 */
import crypto from 'node:crypto';
import { generateToolImage } from '../src/lib/image-gen.js';
import { uploadToolOutput } from '../src/lib/storage.js';
import { supabase } from '../src/lib/supabase.js';

const TOOL_KEY = 'prompts_magicos';

type Mode = 'texto' | 'imagem' | 'texto_imagem';
interface Entry {
	title: string;
	description: string;
	category: string;
	mode: Mode;
	maxImages?: number;
	/** prompt_script: o que o motor injeta. Modo imagem opera sobre a foto; modo texto usa {tema}. */
	prompt: string;
	/** prompt de CAPA (texto→imagem) — resultado representativo pra galeria. */
	cover: string;
}

const LASER =
	'Estilo gravação a laser: preto puro #000000 e branco puro #FFFFFF, altíssimo contraste, vetorial/line-art limpo, traços bem definidos, fundo branco sólido, SEM gradiente, SEM tons de cinza, SEM sombra, SEM textura, sem moldura.';

const ENTRIES: Entry[] = [
	// ───────── Transformação de imagem (cliente sobe a foto) ─────────
	{
		title: 'Foto → Line Art',
		description: 'Transforma a foto em contorno (line art) limpo.',
		category: 'Retratos',
		mode: 'imagem',
		prompt: `Converter a imagem fornecida em line art (arte de contorno) preto sobre branco para gravação a laser.\nTraçar apenas as linhas essenciais que definem formas, contornos e detalhes principais; descartar ruído e fundo.\nLinhas pretas (#000000) contínuas e de espessura uniforme sobre fundo branco puro (#FFFFFF).\nSem preenchimentos sólidos pesados, sem gradiente, sem cinza, sem sombra.\nResultado: desenho de uma linha clean, contornos fechados, pronto pra gravação.`,
		cover: `Desenho line art de um rosto de pessoa, apenas contornos pretos finos. ${LASER}`,
	},
	{
		title: 'Retrato Stencil',
		description: 'Retrato em alto contraste, blocos sólidos (stencil).',
		category: 'Retratos',
		mode: 'imagem',
		prompt: `Converter a foto em um retrato stencil de alto contraste para gravação a laser.\nReduzir a imagem a DOIS tons apenas: preto sólido (#000000) e branco (#FFFFFF), no estilo chiaroscuro.\nAgrupar luzes e sombras em blocos sólidos e conectados que descrevem o rosto; preservar o reconhecimento da pessoa.\nNada de meios-tons, gradiente ou cinza. Áreas pretas devem formar formas fechadas e "cortáveis".\nResultado: retrato pop/stencil dramático, limpo, pronto pra gravar.`,
		cover: `Retrato stencil de alto contraste de um homem, dois tons (preto e branco), estilo chiaroscuro. ${LASER}`,
	},
	{
		title: 'Retrato de Pet',
		description: 'Pet (cão/gato) em arte de gravação de traço limpo.',
		category: 'Pets',
		mode: 'imagem',
		prompt: `Converter a foto do pet (cão, gato ou outro animal) em arte de gravação a laser preto e branco.\nDestacar olhos, focinho, textura do pelo principal e contorno em traços limpos e expressivos.\nAlto contraste, preto puro e branco puro, sem cinza nem gradiente. Manter a "fofura" e o reconhecimento do animal.\nFundo branco, contornos fechados.\nResultado: retrato do pet em line art/stencil ideal pra plaquinha ou medalha gravada.`,
		cover: `Retrato de um cachorro golden retriever em line art preto e branco de alto contraste. ${LASER}`,
	},
	{
		title: 'Litofania (Foto → Tons)',
		description: 'Foto em escala de cinza invertida p/ litofania.',
		category: 'Foto',
		mode: 'imagem',
		prompt: `Preparar a foto fornecida para LITOFANIA gravada a laser.\nConverter em escala de cinza suave e INVERTER os tons (claro vira escuro), de modo que as áreas mais espessas correspondam às sombras.\nManter transições suaves de profundidade e o máximo de detalhe do rosto/cena; alto detalhe, sem saturação de cor.\nEnquadrar centralizado, sem moldura.\nResultado: mapa de profundidade em tons, pronto pra litofania retroiluminada.`,
		cover: `Litofania monocromática de um retrato, tons de cinza invertidos mostrando profundidade, alto detalhe, fundo escuro.`,
	},
	{
		title: 'Logo 1 Cor',
		description: 'Logo colorido → uma cor sólida, vetorial.',
		category: 'Logos',
		mode: 'imagem',
		prompt: `Converter o logo fornecido em versão de UMA COR (preto sólido) vetorial para gravação a laser.\nRemover todas as cores e efeitos; transformar em silhueta/linha preta limpa sobre branco, preservando legibilidade da marca, símbolo e tipografia.\nSem gradiente, sombra, bitmap ou cinza. Caminhos fechados e nítidos.\nResultado: logo mono-cor profissional, pronto pra gravar ou cortar.`,
		cover: `Logo minimalista de uma cafeteria em uma cor (preto sólido), vetorial, símbolo de xícara e texto. ${LASER}`,
	},
	{
		title: 'Halftone / Pop Art',
		description: 'Foto em pontilhado halftone preto.',
		category: 'Foto',
		mode: 'imagem',
		prompt: `Converter a foto em arte HALFTONE (pontos) preta sobre branco para gravação a laser.\nRepresentar os tons por densidade de pontos pretos redondos: áreas escuras com pontos grandes/juntos, áreas claras com pontos pequenos/espaçados.\nApenas preto puro e branco puro, sem cinza contínuo. Visual pop-art/comic limpo.\nResultado: imagem halftone gravável de alto impacto.`,
		cover: `Retrato halftone pop-art de uma mulher, feito de pontos pretos sobre branco, estilo comic. ${LASER}`,
	},
	{
		title: 'Selo / Carimbo',
		description: 'Logo → arte de carimbo circular.',
		category: 'Logos',
		mode: 'imagem',
		prompt: `Transformar o logo/símbolo fornecido em arte de SELO/CARIMBO circular para gravação a laser.\nCentralizar o símbolo principal e contorná-lo com um anel/bordas e texto curvo (mantendo qualquer texto da marca).\nUma cor (preto sólido) sobre branco, traços limpos, estilo emblema/sinete clássico.\nSem gradiente nem cinza; tudo vetorial e simétrico.\nResultado: carimbo redondo elegante pronto pra gravar.`,
		cover: `Selo circular vintage estilo carimbo com um símbolo central e texto curvo na borda, uma cor preta. ${LASER}`,
	},
	{
		title: 'Assinatura Vetor',
		description: 'Manuscrito/assinatura → vetor limpo.',
		category: 'Tipografia',
		mode: 'imagem',
		prompt: `Vetorizar a assinatura ou texto manuscrito fornecido para gravação a laser.\nTraçar o traçado da caneta como linhas pretas limpas e contínuas sobre branco, preservando fielmente o estilo da escrita.\nRemover papel, ruído e variações de cor; manter espessura coerente do traço.\nSem cinza, sombra ou textura.\nResultado: assinatura/lettering vetorial nítido, pronto pra gravar em metal ou madeira.`,
		cover: `Assinatura manuscrita elegante em preto sobre fundo branco, traço fino contínuo de caneta. ${LASER}`,
	},
	{
		title: 'Silhueta Minimalista',
		description: 'Rosto/objeto → silhueta preta sólida.',
		category: 'Retratos',
		mode: 'imagem',
		prompt: `Converter a imagem fornecida em uma SILHUETA minimalista preta sólida para gravação a laser.\nReduzir o sujeito a uma única forma preta cheia (#000000) sobre branco, com contorno limpo e reconhecível.\nSem detalhes internos, sem gradiente, sem cinza. Forma fechada e elegante.\nResultado: silhueta clean ideal pra recorte/gravação.`,
		cover: `Silhueta preta sólida de um perfil de rosto de mulher sobre fundo branco, minimalista. ${LASER}`,
	},
	{
		title: 'Brasão Técnico',
		description: 'Emblema/brasão → linha técnica simétrica.',
		category: 'Emblemas',
		mode: 'imagem',
		prompt: `Transformar o brasão/emblema fornecido em desenho de LINHA TÉCNICA preto e branco para gravação a laser.\nRedesenhar com linhas pretas precisas e simétricas, mantendo todos os elementos heráldicos (escudo, fitas, símbolos, texto).\nAlto contraste, sem gradiente, sombra ou cinza; caminhos fechados e equilibrados.\nResultado: brasão vetorial de acabamento profissional, pronto pra gravar.`,
		cover: `Brasão heráldico detalhado em linha preta sobre branco, escudo com leão e fita com texto, simétrico. ${LASER}`,
	},
	{
		title: 'Foto → Sketch',
		description: 'Foto em desenho de hachura (sketch).',
		category: 'Foto',
		mode: 'imagem',
		prompt: `Converter a foto em um SKETCH/desenho à mão preto sobre branco para gravação a laser.\nUsar hachuras e linhas finas para sugerir volume e sombra, mantendo apenas preto puro e branco puro (sem cinza contínuo).\nPreservar feições e contornos principais; descartar fundo.\nResultado: desenho estilo caneta nanquim/esboço gravável.`,
		cover: `Desenho a nanquim (hachura) de uma paisagem de montanha, linhas pretas finas sobre branco, sem cinza. ${LASER}`,
	},
	{
		title: 'Mapa em Linhas',
		description: 'Mapa/planta → arte de linhas finas.',
		category: 'Decorativo',
		mode: 'imagem',
		prompt: `Transformar o mapa, planta ou traçado fornecido em arte de LINHAS finas preto e branco para gravação a laser.\nManter ruas, contornos, curvas e rótulos essenciais como linhas pretas limpas sobre branco; remover cores e preenchimentos desnecessários.\nAlto contraste, sem gradiente nem cinza.\nResultado: mapa estilizado e minimalista, pronto pra gravar em quadro ou placa.`,
		cover: `Mapa de cidade estilizado em linhas pretas finas sobre fundo branco, ruas e rio, minimalista. ${LASER}`,
	},
	{
		title: 'Fotogravação Madeira',
		description: 'Foto otimizada p/ fotogravação realista.',
		category: 'Foto',
		mode: 'imagem',
		prompt: `Otimizar a foto fornecida para FOTOGRAVAÇÃO realista em madeira a laser.\nConverter em escala de cinza de alto detalhe e contraste, realçando bordas e texturas, com tons bem distribuídos (amigável a dithering).\nManter o realismo e o reconhecimento do sujeito; remover fundo poluído.\nResultado: imagem monocromática pronta pra gravação fotográfica detalhada.`,
		cover: `Foto em escala de cinza de alto detalhe de um retrato, otimizada para gravação fotográfica, alto contraste de bordas.`,
	},
	{
		title: 'Tatuagem Fineline',
		description: 'Foto → arte de tatuagem fineline.',
		category: 'Retratos',
		mode: 'imagem',
		prompt: `Converter a imagem fornecida em arte de TATUAGEM fineline preto e branco para gravação a laser.\nUsar linhas pretas finas e elegantes, pontilhismo leve e contornos delicados; estética de tatuagem minimalista.\nApenas preto puro sobre branco, sem cinza contínuo nem gradiente.\nResultado: arte fineline graciosa, pronta pra gravar.`,
		cover: `Arte de tatuagem fineline de uma flor e uma borboleta, linhas pretas finas e delicadas sobre branco. ${LASER}`,
	},

	// ───────── Tema → imagem (cliente digita o tema) ─────────
	{
		title: 'Mandala de {tema}',
		description: 'Mandala ornamental simétrica do tema.',
		category: 'Decorativo',
		mode: 'texto',
		prompt: `Crie uma MANDALA ornamental circular inspirada em "{tema}" para gravação a laser.\nDesign perfeitamente simétrico e radial, com padrões intrincados que remetam ao tema.\n${LASER}\nLinhas pretas detalhadas sobre branco, caminhos fechados, centralizada, sem texto.`,
		cover: `Mandala ornamental circular intrincada e simétrica, linhas pretas finas sobre branco, estilo decorativo. ${LASER}`,
	},
	{
		title: 'Placa de Nome "{tema}"',
		description: 'Nome em placa decorativa elegante.',
		category: 'Placas',
		mode: 'texto',
		prompt: `Crie uma PLACA DE NOME decorativa com a palavra/nome "{tema}" para gravação a laser.\nTipografia bonita e legível (script ou serifada elegante) com ornamentos florais/folhas ao redor de forma equilibrada.\n${LASER}\nComposição centralizada, contornos limpos, ideal pra placa de porta ou enfeite.`,
		cover: `Placa de nome decorativa com a palavra "Família" em tipografia script elegante e ornamentos de folhas, preto sobre branco. ${LASER}`,
	},
	{
		title: 'Mascote Line Art',
		description: 'Mascote/personagem do tema em line art.',
		category: 'Logos',
		mode: 'texto',
		prompt: `Crie um MASCOTE/personagem simpático representando "{tema}" em estilo line art para gravação a laser.\nDesenho cartoon limpo, contornos pretos definidos, expressão marcante, estilo logo/clip-art de uma cor.\n${LASER}\nFormas fechadas, sem texto, centralizado.`,
		cover: `Mascote cartoon de um lobo simpático em line art preto sobre branco, estilo logo de uma cor. ${LASER}`,
	},
	{
		title: 'Arte Botânica',
		description: 'Composição floral/botânica do tema.',
		category: 'Decorativo',
		mode: 'texto',
		prompt: `Crie uma composição BOTÂNICA/floral inspirada em "{tema}" para gravação a laser.\nFolhas, flores e ramos desenhados em linhas pretas elegantes e equilibradas, estilo gravura botânica.\n${LASER}\nDetalhe fino, contornos fechados, sem texto.`,
		cover: `Ilustração botânica de um ramo de eucalipto e flores, linhas pretas finas sobre branco, estilo gravura. ${LASER}`,
	},
	{
		title: 'Padrão Geométrico',
		description: 'Padrão geométrico do tema (sem emenda).',
		category: 'Decorativo',
		mode: 'texto',
		prompt: `Crie um PADRÃO GEOMÉTRICO inspirado em "{tema}" para gravação a laser.\nFormas geométricas repetidas e encaixadas (preferencialmente sem emenda/seamless), simétrico e equilibrado.\n${LASER}\nLinhas pretas precisas sobre branco, sem texto.`,
		cover: `Padrão geométrico sem emenda com hexágonos e linhas, preto sobre branco, simétrico e limpo. ${LASER}`,
	},
	{
		title: 'Frase Tipográfica',
		description: 'Frase/citação em tipografia ornamental.',
		category: 'Tipografia',
		mode: 'texto',
		prompt: `Crie uma composição de TIPOGRAFIA ornamental com a frase "{tema}" para gravação a laser.\nMisturar fontes script e maiúsculas de forma harmônica, com pequenos ornamentos/floreios, centralizada e legível.\n${LASER}\nApenas preto sobre branco, contornos limpos.`,
		cover: `Composição de lettering ornamental com a frase "Be Brave", mistura de script e serifada, preto sobre branco. ${LASER}`,
	},
	{
		title: 'Caveira (Skull Art)',
		description: 'Caveira decorativa temática.',
		category: 'Emblemas',
		mode: 'texto',
		prompt: `Crie uma CAVEIRA decorativa (skull art) temática de "{tema}" para gravação a laser.\nEstilo ornamental/sugar skull ou linha, com detalhes que remetam ao tema, simétrica e marcante.\n${LASER}\nLinhas e blocos pretos sobre branco, contornos fechados, sem texto.`,
		cover: `Caveira ornamental tipo sugar skull com flores e detalhes simétricos, preto sobre branco, alto contraste. ${LASER}`,
	},
	{
		title: 'Animal Tribal',
		description: 'Animal do tema em estilo tribal.',
		category: 'Emblemas',
		mode: 'texto',
		prompt: `Crie a arte de um ANIMAL representando "{tema}" em estilo TRIBAL/tatuagem para gravação a laser.\nFormas pretas sólidas e pontas afiadas, design simétrico e impactante, estilo totem tribal.\n${LASER}\nFormas fechadas, sem texto, centralizado.`,
		cover: `Águia em estilo tribal, formas pretas sólidas e afiadas, simétrica, sobre fundo branco. ${LASER}`,
	},
	{
		title: 'Skyline em Linha',
		description: 'Skyline/paisagem do tema em linha.',
		category: 'Decorativo',
		mode: 'texto',
		prompt: `Crie a SKYLINE ou paisagem de "{tema}" em arte de linha para gravação a laser.\nSilhueta/contorno dos prédios ou elementos marcantes em preto sobre branco, estilizado e limpo.\n${LASER}\nComposição horizontal equilibrada, sem texto (a menos que o tema seja um nome de cidade — então incluir discreto).`,
		cover: `Skyline de uma cidade em silhueta e linha preta sobre fundo branco, prédios marcantes, estilizado. ${LASER}`,
	},
	{
		title: 'Emblema Esportivo',
		description: 'Emblema/escudo esportivo do tema.',
		category: 'Emblemas',
		mode: 'texto',
		prompt: `Crie um EMBLEMA/escudo esportivo inspirado em "{tema}" para gravação a laser.\nEscudo com símbolo central forte e texto curvo, estilo logo de time, uma cor.\n${LASER}\nSimétrico, caminhos fechados, alto impacto.`,
		cover: `Emblema esportivo tipo escudo de time com um tigre e fita de texto, uma cor preta sobre branco. ${LASER}`,
	},
	{
		title: 'Badge Vintage',
		description: 'Selo/badge retrô do tema.',
		category: 'Emblemas',
		mode: 'texto',
		prompt: `Crie um BADGE/selo vintage retrô inspirado em "{tema}" para gravação a laser.\nFormato circular ou hexagonal com texto, símbolo central e detalhes clássicos (raios, fitas, estrelas).\n${LASER}\nUma cor preta sobre branco, simétrico, estilo etiqueta retrô.`,
		cover: `Badge vintage circular com uma montanha, texto "Adventure" e raios, uma cor preta sobre branco, estilo retrô. ${LASER}`,
	},
];

function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[{}]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'prompt'
	);
}

async function main() {
	const { data: existing, error: exErr } = await supabase
		.from('pl_tool_bank_entry')
		.select('title, position')
		.eq('tool_key', TOOL_KEY);
	if (exErr) {
		console.error('Erro lendo registros existentes:', exErr.message);
		process.exit(1);
	}
	const existingTitles = new Set(
		(existing ?? []).map((r) => String(r.title).trim().toLowerCase()),
	);
	let nextPos =
		(existing ?? []).length > 0
			? Math.max(...(existing ?? []).map((r) => Number(r.position) || 0)) + 1
			: 0;

	let created = 0;
	let skipped = 0;
	let coverFail = 0;

	for (const e of ENTRIES) {
		if (existingTitles.has(e.title.trim().toLowerCase())) {
			skipped++;
			console.log(`• pulado (já existe): ${e.title}`);
			continue;
		}

		let exampleAfterUrl: string | null = null;
		try {
			const { png } = await generateToolImage(e.cover);
			exampleAfterUrl = await uploadToolOutput(
				'prompts-magicos',
				png,
				`${slugify(e.title)}-${crypto.randomUUID().slice(0, 8)}.png`,
				'image/png',
			);
			console.log(`  ✓ capa gerada: ${e.title}`);
		} catch (err) {
			coverFail++;
			console.warn(
				`  ! capa falhou (insere sem capa): ${e.title} — ${(err as Error).message}`,
			);
		}

		const { error } = await supabase.from('pl_tool_bank_entry').insert({
			tool_key: TOOL_KEY,
			title: e.title,
			description: e.description,
			category: e.category,
			position: nextPos++,
			active: true,
			data: {
				prompt_script: e.prompt,
				mode: e.mode,
				...(e.maxImages ? { max_images: e.maxImages } : {}),
			},
			example_after_url: exampleAfterUrl,
		});
		if (error) {
			console.error(`  ✗ INSERT falhou: ${e.title} — ${error.message}`);
			continue;
		}
		created++;
		console.log(`✔ criado: ${e.title}`);
	}

	console.log(
		`\n== DONE == criados=${created} pulados=${skipped} capa_falhou=${coverFail} (total no banco agora = ${(existing ?? []).length + created})`,
	);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
