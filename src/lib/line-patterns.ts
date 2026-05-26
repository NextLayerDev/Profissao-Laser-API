export type LinePatternType =
	| 'none'
	| 'horizontal'
	| 'vertical'
	| 'diagonal45'
	| 'diagonal135'
	| 'crosshatch'
	| 'diamondHatch';

export interface LinePatternOptions {
	pattern: LinePatternType;
	spacing: number;
	angle?: number;
	strokeWidth?: number;
	color?: string;
}

const PATTERN_ANGLES: Record<string, number[]> = {
	horizontal: [0],
	vertical: [90],
	diagonal45: [45],
	diagonal135: [135],
	crosshatch: [0, 90],
	diamondHatch: [45, 135],
};

/**
 * Aplica padrao de linhas ao SVG, clipado ao shape tracado.
 * Extrai os paths do SVG original e usa como clipPath.
 */
export function applyLinePattern(
	svgContent: string,
	options: LinePatternOptions,
): string {
	if (options.pattern === 'none') return svgContent;

	const spacing = options.spacing ?? 3;
	const lineWidth = options.strokeWidth ?? 0.5;
	const color = options.color ?? '#000000';

	// Extrair dimensoes do SVG
	const widthMatch = svgContent.match(/width="([^"]+)"/);
	const heightMatch = svgContent.match(/height="([^"]+)"/);
	const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);

	const svgWidth = widthMatch ? widthMatch[1] : '500';
	const svgHeight = heightMatch ? heightMatch[1] : '500';
	const viewBox = viewBoxMatch
		? viewBoxMatch[1]
		: `0 0 ${svgWidth} ${svgHeight}`;

	// Extrair todos os path "d" attributes
	const pathRegex = /<path[^>]*\sd="([^"]+)"/g;
	const pathDMatches: RegExpExecArray[] = [];
	let match: RegExpExecArray | null = pathRegex.exec(svgContent);
	while (match !== null) {
		pathDMatches.push(match);
		match = pathRegex.exec(svgContent);
	}
	if (pathDMatches.length === 0) return svgContent;

	const pathDs = pathDMatches.map((m) => m[1]);

	// Determinar angulos a usar
	let angles: number[];
	if (options.angle !== undefined && options.angle !== null) {
		angles = [options.angle];
	} else {
		angles = PATTERN_ANGLES[options.pattern] || [0];
	}

	// Construir defs com patterns e clipPath
	const clipPaths = pathDs.map((d) => `<path d="${d}"/>`).join('\n      ');

	let defs = `<defs>
    <clipPath id="shapeClip">
      ${clipPaths}
    </clipPath>`;

	const patternElements: string[] = [];
	for (let i = 0; i < angles.length; i++) {
		const angle = angles[i];
		const patId = `linePattern${i}`;
		// Usar spacing grande o suficiente para cobrir rotacao diagonal
		const patSize = spacing;
		defs += `
    <pattern id="${patId}" patternUnits="userSpaceOnUse" width="${patSize}" height="${patSize}" patternTransform="rotate(${angle})">
      <line x1="0" y1="0" x2="${patSize}" y2="0" stroke="${color}" stroke-width="${lineWidth}"/>
    </pattern>`;

		// Parse viewBox para pegar dimensoes numericas
		const vbParts = viewBox.split(/\s+/).map(Number);
		const rectW = vbParts[2] || parseFloat(svgWidth) || 500;
		const rectH = vbParts[3] || parseFloat(svgHeight) || 500;

		patternElements.push(
			`<rect width="${rectW}" height="${rectH}" fill="url(#${patId})" clip-path="url(#shapeClip)"/>`,
		);
	}

	defs += '\n  </defs>';

	// Rebuild SVG: manter tag de abertura, inserir defs e rects, fechar
	const svgOpenMatch = svgContent.match(/<svg[^>]*>/);
	if (!svgOpenMatch) return svgContent;
	const svgOpen = svgOpenMatch[0];

	// Extrair conteudo original entre <svg> e </svg>
	const innerContent = svgContent
		.replace(svgOpen, '')
		.replace('</svg>', '')
		.trim();

	return `${svgOpen}
  ${defs}
  ${innerContent}
  ${patternElements.join('\n  ')}
</svg>`;
}
