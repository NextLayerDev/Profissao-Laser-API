// ─────────────────────────────────────────────────────────────────────────
// U2-Net background removal — self-hosted via onnxruntime-web (WASM).
// Modelo: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx
//
// Roda em WebAssembly puro (sem binary nativo glibc/musl), portanto
// funciona em qualquer base do Node — Alpine, slim, full Debian.
// Trade-off vs. onnxruntime-node: ~2-3x mais lento por usar WASM em vez
// de bindings nativos. Para ~5 chamadas/dia/customer é mais que suficiente.
// ─────────────────────────────────────────────────────────────────────────

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';

// Single-threaded WASM (mais previsível em servidor; threading de WASM
// requer SharedArrayBuffer + COOP/COEP que podem variar por host).
ort.env.wasm.numThreads = 1;

const MODEL_URL =
	'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx';
const MODEL_INPUT_SIZE = 320; // U2-Net espera 320x320 NCHW
const NORM_MEAN = [0.485, 0.456, 0.406];
const NORM_STD = [0.229, 0.224, 0.225];

function getModelPath(): string {
	if (process.env.U2NET_MODEL_PATH) return process.env.U2NET_MODEL_PATH;
	return path.join(os.tmpdir(), 'profissao-laser-api', 'u2net.onnx');
}

let session: ort.InferenceSession | null = null;
let loadingPromise: Promise<ort.InferenceSession> | null = null;

async function downloadModel(targetPath: string): Promise<void> {
	console.log(`[u2net] Baixando modelo (~176MB) de ${MODEL_URL}...`);
	const dir = path.dirname(targetPath);
	if (!existsSync(dir)) await mkdir(dir, { recursive: true });

	const response = await fetch(MODEL_URL);
	if (!response.ok || !response.body) {
		throw new Error(
			`Falha ao baixar modelo U2-Net: HTTP ${response.status}. Verifique conexão.`,
		);
	}

	// Stream para disco evitando carregar 176MB na RAM
	const fileStream = createWriteStream(targetPath);
	// biome-ignore lint/suspicious/noExplicitAny: Node stream typing entre web e node
	await pipeline(Readable.fromWeb(response.body as any), fileStream);
	console.log(`[u2net] Modelo salvo em ${targetPath}`);
}

async function getSession(): Promise<ort.InferenceSession> {
	if (session) return session;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		const modelPath = getModelPath();
		if (!existsSync(modelPath)) {
			await downloadModel(modelPath);
		}
		console.log(`[u2net] Carregando modelo em ${modelPath}...`);
		// onnxruntime-web não aceita file path direto em Node — carrega bytes
		// do disco e passa como Uint8Array.
		const modelBytes = await readFile(modelPath);
		const s = await ort.InferenceSession.create(modelBytes, {
			executionProviders: ['wasm'],
			graphOptimizationLevel: 'all',
		});
		session = s;
		return s;
	})();

	try {
		return await loadingPromise;
	} finally {
		loadingPromise = null;
	}
}

/**
 * Remove o fundo de uma imagem usando U2-Net localmente (WASM).
 * Retorna um buffer PNG RGBA com o fundo transparente.
 */
export async function removeBackgroundLocal(input: Buffer): Promise<Buffer> {
	const ortSession = await getSession();

	// 1. Carregar imagem original e pegar dimensões
	const originalMeta = await sharp(input).metadata();
	const origWidth = originalMeta.width ?? 0;
	const origHeight = originalMeta.height ?? 0;
	if (!origWidth || !origHeight) {
		throw new Error('Imagem inválida: não foi possível ler dimensões.');
	}

	// 2. Resize para 320x320 RGB raw
	const { data: resized } = await sharp(input)
		.removeAlpha()
		.resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill' })
		.raw()
		.toBuffer({ resolveWithObject: true });

	// 3. Normalizar e converter para tensor NCHW Float32
	const pixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
	const tensor = new Float32Array(3 * pixels);
	for (let i = 0; i < pixels; i++) {
		const r = resized[i * 3] / 255;
		const g = resized[i * 3 + 1] / 255;
		const b = resized[i * 3 + 2] / 255;
		tensor[i] = (r - NORM_MEAN[0]) / NORM_STD[0]; // R channel
		tensor[i + pixels] = (g - NORM_MEAN[1]) / NORM_STD[1]; // G channel
		tensor[i + 2 * pixels] = (b - NORM_MEAN[2]) / NORM_STD[2]; // B channel
	}

	// 4. Inferência via WASM
	const inputName = ortSession.inputNames[0];
	const outputName = ortSession.outputNames[0];
	const feeds: Record<string, ort.Tensor> = {
		[inputName]: new ort.Tensor('float32', tensor, [
			1,
			3,
			MODEL_INPUT_SIZE,
			MODEL_INPUT_SIZE,
		]),
	};
	const results = await ortSession.run(feeds);
	const maskOutput = results[outputName].data as Float32Array;

	// 5. Min-max normalize → 0..1
	let minV = Infinity;
	let maxV = -Infinity;
	for (let i = 0; i < maskOutput.length; i++) {
		if (maskOutput[i] < minV) minV = maskOutput[i];
		if (maskOutput[i] > maxV) maxV = maskOutput[i];
	}
	const range = maxV - minV || 1;

	// 6. Converter para Uint8 (0..255) — máscara em 320x320
	const maskUint8 = Buffer.alloc(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
	for (let i = 0; i < maskOutput.length; i++) {
		const v = (maskOutput[i] - minV) / range;
		maskUint8[i] = Math.round(v * 255);
	}

	// 7. Resize máscara de volta para tamanho original
	const fullMask = await sharp(maskUint8, {
		raw: {
			width: MODEL_INPUT_SIZE,
			height: MODEL_INPUT_SIZE,
			channels: 1,
		},
	})
		.resize(origWidth, origHeight, { fit: 'fill' })
		.raw()
		.toBuffer();

	// 8. Composite: pega imagem original RGB + máscara como alpha
	const originalRgb = await sharp(input).removeAlpha().raw().toBuffer();
	const rgba = Buffer.alloc(origWidth * origHeight * 4);
	for (let i = 0; i < origWidth * origHeight; i++) {
		rgba[i * 4] = originalRgb[i * 3];
		rgba[i * 4 + 1] = originalRgb[i * 3 + 1];
		rgba[i * 4 + 2] = originalRgb[i * 3 + 2];
		rgba[i * 4 + 3] = fullMask[i];
	}

	return sharp(rgba, {
		raw: { width: origWidth, height: origHeight, channels: 4 },
	})
		.png()
		.toBuffer();
}
