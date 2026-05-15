// ─────────────────────────────────────────────────────────────────
// Cópia verbatim do prompt + helpers de:
//   system_porteira/src/app/api/gerar-previa-ia/route.ts (linhas 25–1452)
// Mantido idêntico para garantir que o output do Gemini seja igual.
// ─────────────────────────────────────────────────────────────────

// Função otimizada para converter URL de imagem para base64 com timeout
export async function imageUrlToBase64(url: string): Promise<string> {
	try {
		// Se já for base64, retorna direto
		if (url.startsWith('data:image')) {
			const base64Part = url.split(',')[1];
			if (base64Part) return base64Part;
		}

		// Criar controller para timeout de 10 segundos
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);

		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				Accept: 'image/*',
			},
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		return buffer.toString('base64');
	} catch (error) {
		const err = error as { name?: string; message?: string };
		if (err.name === 'AbortError') {
			throw new Error('Timeout ao carregar imagem');
		}
		console.error('Erro ao converter imagem para base64:', err.message);
		throw new Error(`Falha ao processar a imagem: ${err.message}`);
	}
}

// Função para gerar o prompt baseado no produto e configurações
export function generatePrompt(
	productName: string,
	laserSettings: import('../types/previa.js').LaserSettings,
	hasCustomName: boolean,
	customName?: string,
	instrucoesPersonalizadas?: string | null,
	modoLentes?: boolean,
	textoLenteDireita?: string,
	textoLenteEsquerda?: string,
	hasWatermark: boolean = false,
): string {
	const sizeMap: Record<string, string> = {
		pequeno:
			'Small (~15-20% of engravable surface area) - discreet and minimal',
		medio: 'Medium (~30-40% of engravable surface area) - balanced and visible',
		grande:
			'Large (~50-60% of engravable surface area) - prominent and detailed',
		custom: 'Custom - fit proportionally to product surface (~40%)',
	};

	const positionMap: Record<string, string> = {
		central:
			'EXACT CENTER of visible product surface - horizontally AND vertically centered',
		superior:
			'UPPER THIRD (top 33%) of product - horizontally centered, vertically in top area',
		inferior:
			'LOWER THIRD (bottom 33%) of product - horizontally centered, vertically in bottom area',
		lateral: 'LEFT OR RIGHT side of product - offset from center towards edge',
	};

	// Descrições visuais detalhadas para posicionamento
	const positionDetailMap: Record<string, string[]> = {
		central: [
			'│ 📍 EXACT POSITIONING - CENTER:                           │',
			'│    • Horizontal: 50% from left edge                      │',
			'│    • Vertical: 50% from top edge                         │',
			'│    • Logo center point = product surface center point    │',
			'│    • Equal margins on ALL sides                          │',
			'│    • Visually balanced and symmetrical                   │',
		],
		superior: [
			'│ 📍 EXACT POSITIONING - UPPER AREA:                       │',
			'│    • Horizontal: 50% from left edge (centered)           │',
			'│    • Vertical: 15-25% from TOP edge                      │',
			'│    • Logo placed in UPPER THIRD of product               │',
			'│    • More space BELOW logo than above                    │',
			'│    • Ideal for products viewed from front                │',
		],
		inferior: [
			'│ 📍 EXACT POSITIONING - LOWER AREA:                       │',
			'│    • Horizontal: 50% from left edge (centered)           │',
			'│    • Vertical: 70-85% from TOP edge (near bottom)        │',
			'│    • Logo placed in LOWER THIRD of product               │',
			'│    • More space ABOVE logo than below                    │',
			'│    • Ideal for products with caps/lids at top            │',
		],
		lateral: [
			'│ 📍 EXACT POSITIONING - LATERAL/SIDE:                     │',
			'│    • Horizontal: 25% OR 75% from left edge               │',
			'│    • Vertical: 50% from top edge (vertically centered)   │',
			'│    • Logo offset to LEFT or RIGHT side                   │',
			'│    • Leaves space on opposite side                       │',
			'│    • Ideal for wide products or secondary branding       │',
		],
	};

	const intensityMap: Record<string, string> = {
		baixa: 'Light (25%) - subtle engraving with minimal contrast',
		media: 'Medium (50%) - balanced engraving with good visibility',
		alta: 'Strong (75%) - pronounced engraving with high contrast',
		maxima: 'Maximum (100%) - deep engraving with maximum contrast',
	};

	const depthMap: Record<string, string> = {
		superficial: 'Shallow (0.1mm) - light surface marking',
		media: 'Medium (0.3mm) - standard engraving depth',
		profunda: 'Deep (0.5mm) - pronounced depth with strong relief',
	};

	// Mapas para novos parâmetros avançados
	const materialMap: Record<string, string> = {
		'aco-inox':
			'Stainless steel (inox) - metallic silver surface, smooth and reflective, industrial quality',
		madeira:
			'Natural wood - warm brown tones, visible wood grain texture, organic appearance',
		couro:
			'Genuine leather - rich brown/black surface, soft matte texture with subtle grain pattern',
		acrilico:
			'Clear/colored acrylic - smooth plastic surface, semi-transparent edges, modern look',
		vidro:
			'Glass - transparent/frosted surface, delicate etching appearance, elegant finish',
		aluminio:
			'Brushed aluminum - lighter metallic tone, directional brush strokes visible, lightweight',
		tecido:
			'Fabric/textile - soft woven surface, visible thread texture, embroidered or heat-transferred appearance',
	};

	const styleMap: Record<string, string> = {
		clean:
			'Clean/Minimal - precise sharp lines, no extra decoration, modern professional aesthetic',
		vintage:
			'Vintage/Distressed - slightly worn edges, aged patina effect, retro texture appearance',
		elegante:
			'Elegant/Ornate - refined details, subtle flourishes, premium luxury feel',
		industrial:
			'Industrial - raw bold look, mechanical precision, factory/workshop aesthetic',
		futurista:
			'Futuristic - geometric patterns, glowing edge effects, sci-fi inspired design',
	};

	const finishMap: Record<string, string> = {
		fosco: 'Matte finish - no reflections, flat diffused surface appearance',
		brilhante: 'Glossy finish - reflective polished surface, mirror-like shine',
		escovado: 'Brushed finish - directional lines, satin metallic appearance',
	};

	const frameMap: Record<string, string> = {
		nenhuma: 'No border/frame around engraving',
		simples:
			'Simple thin line border - single clean line around the engraving area',
		dupla:
			'Double-line border - two parallel lines with small gap enclosing engraving',
		ornamental:
			'Decorative ornamental border - elegant frame with corner flourishes and details',
		arredondada:
			'Rounded/pill-shaped border - soft curved frame enclosing the engraving',
	};

	const textPositionMap: Record<string, string> = {
		abaixo:
			'Text positioned BELOW the logo, horizontally centered, with spacing gap',
		acima:
			'Text positioned ABOVE the logo, horizontally centered, with spacing gap',
		'lado-esquerdo':
			'Text positioned to the LEFT of the logo, vertically centered alongside',
		'lado-direito':
			'Text positioned to the RIGHT of the logo, vertically centered alongside',
		integrado:
			'Text integrated INTO/overlapping the logo design as unified composition',
	};

	const spacingMap: Record<string, string> = {
		justo:
			'Tight spacing (2-4% of surface) - logo and text close together, compact layout',
		medio: 'Medium spacing (6-8% of surface) - balanced gap between elements',
		amplo:
			'Wide spacing (10-14% of surface) - generous separation, airy layout',
	};

	// ─── Mapas para tipo de prévia / registro fotográfico ────────────────────
	const tipoVisualizacaoMap: Record<string, string> = {
		'frontal-padrao':
			'PACKSHOT / FRONTAL STANDARD — Product centered, clean neutral background, camera directly facing product at eye level (0°), uniform even lighting. Classic e-commerce product shot style.',
		'angulo-3d':
			'THREE-QUARTER PERSPECTIVE — Camera at 45° angle (3/4 view), product shows front AND side simultaneously. Adds depth and dimensionality. Studio lighting from upper-left.',
		'360':
			'COMPOSITE 360° GRID — Create a SINGLE IMAGE containing a 2×3 grid of 6 product views (front, back, left, right, top, 45° angle). All 6 sub-images show the SAME product with the SAME engraving. Equal cell sizes, thin gray dividers between cells, each cell labeled (FRONT, BACK, LEFT, RIGHT, TOP, 45°). This is a composite flat-lay grid, NOT a circular rotation effect.',
		'closeup-gravacao':
			'EXTREME MACRO CLOSE-UP — Camera extremely close to the engraved area. The engraving fills 70–80% of the frame. Razor-sharp focus on engraving texture and depth. Shows microscopic detail of laser marks, burnt edges, metallic relief. Shallow depth of field, bokeh on surrounding product areas.',
		lifestyle:
			'LIFESTYLE / SCENE — Product placed in a decorated real-life context that matches its use case (desk, kitchen, outdoor table, gift setting, etc.). Props and environment complement the product. Realistic ambient lighting. Shows product IN USE or display context.',
		'flat-lay':
			'FLAT LAY / TOP-DOWN STYLED — Product lying flat, camera directly overhead (90°), surrounded by complementary props or accessories arranged artistically. Clean or textured surface. High-contrast lighting from above. Product is the focal point of the composition.',
		'em-uso':
			'IN-USE / HAND SHOT — A human hand holds the product naturally, simulating real use. Warm realistic lighting. Casual lifestyle aesthetic. Product engraving clearly visible. Partial hand/wrist visible, rest of frame focused on product.',
		overhead:
			'OVERHEAD / BIRDS-EYE — Camera positioned directly above product at 90°, pointing straight down. Product perfectly centered. Clean background visible around product. Even, diffused lighting from above with minimal shadows.',
		'multi-angulo':
			'MULTI-ANGLE COMPOSITE GRID — Single image containing a 2×2 grid of 4 distinct product angles (front, 45° left, 45° right, overhead). Same product and engraving in all 4 cells. Equal cell sizes, subtle dividers. Each cell labeled with the angle name.',
		'render-3d':
			'PHOTOREALISTIC 3D RENDER STYLE — CGI rendering aesthetic with studio HDRI lighting, perfect reflections on metal surfaces, ray-traced shadows, sub-surface scattering on appropriate materials. Hyperrealistic quality exceeding real photography. Dramatic specular highlights on engraved surface.',
		fotogravacao:
			'PHOTO ENGRAVING (FOTOGRAVAÇÃO) — The logo image is laser-engraved as a PHOTOGRAPHIC HALFTONE directly onto the product surface. The engraving replicates every tone of the source image using variable dot density and depth: dark areas = dense/deep dots, light areas = sparse/shallow dots. The result looks like a photograph physically burned into the material — grayscale tones rendered entirely in metallic engraving marks with no colors. The product surface shows the image as if printed by laser dots. CRITICAL: engraving must simulate real photographic halftone laser output — visible dot/line pattern texture, depth variation across the image, authentic burned metallic appearance.',
	};

	const anguloCameraMap: Record<string, string> = {
		frontal:
			'Camera angle: FRONTAL 0° — lens faces product straight on, product face fully visible, no perspective distortion',
		'45-esquerda':
			'Camera angle: 3/4 LEFT 45° — camera positioned to the left of center at 45°, product shows front + left side',
		'45-direita':
			'Camera angle: 3/4 RIGHT -45° — camera positioned to the right of center at 45°, product shows front + right side',
		'superior-45':
			'Camera angle: SEMI-OVERHEAD 70° — camera elevated to ~70° above eye level, shows top portion and front face of product',
		overhead:
			'Camera angle: TOP-DOWN 90° — camera directly above product pointing straight down, only top face of product visible',
	};

	const iluminacaoMap: Record<string, string> = {
		'studio-softbox':
			'STUDIO SOFTBOX LIGHTING — Large diffused light source, soft shadows with gradual falloff, even illumination across product surface, professional product photography quality, no harsh shadows',
		'luz-natural':
			'NATURAL WINDOW LIGHT — Warm lateral sunlight from window, gentle soft shadows on one side, warm color temperature (5500K), realistic outdoor-adjacent lighting',
		'rim-light':
			'RIM / BACK LIGHTING — Strong light source behind and slightly to side of product, creates bright edge outline (rim light effect), dark background, product silhouette glows, high-drama aesthetic',
		dramatica:
			'DRAMATIC HIGH-CONTRAST LIGHTING — Single strong directional light, deep pronounced shadows, chiaroscuro effect, cinematic quality, strong tonal contrast between lit and shadow areas',
		'produto-heroi':
			'HERO PRODUCT LIGHTING — Multiple balanced lights (key + fill + back), zero shadows, flat even illumination, every detail perfectly visible, maximum product clarity, professional catalogue quality',
		ambiente:
			'AMBIENT ENVIRONMENT LIGHTING — Diffused multi-directional environmental light matching scene context, realistic and natural, consistent with lifestyle or location setting',
	};

	const fundoCenaMap: Record<string, string> = {
		'branco-puro':
			'PURE WHITE BACKGROUND (#FFFFFF) — Clean studio white, standard e-commerce packshot background, no shadows or gradients, product floats on white',
		'cinza-gradiente':
			'NEUTRAL GRAY GRADIENT — Soft gradient from light gray to mid gray, professional studio backdrop, subtle vignette, timeless product photography neutral',
		'preto-fosco':
			'MATTE BLACK BACKGROUND — Deep solid black (#111111), premium and elegant aesthetic, strong contrast with product, luxury brand feel',
		madeira:
			'NATURAL WOOD SURFACE — Warm brown wood grain texture (oak, walnut, or pine tones), horizontal grain lines, natural organic aesthetic, rustic or artisan feel',
		marmore:
			'MARBLE SURFACE — White or black marble with natural veining pattern, elegant and premium, cool stone texture, luxury product photography aesthetic',
		'tecido-linho':
			'LINEN / FABRIC TEXTURE — Natural off-white linen cloth texture, subtle fabric weave visible, organic and artisan feel, warm neutral tones',
		'ambiente-decorado':
			'DECORATED SCENE ENVIRONMENT — Full styled scene with contextual props (books, plants, desk accessories, kitchen items, etc.) arranged around product. Rich environmental context, realistic and aspirational.',
		transparente:
			'TRANSPARENT BACKGROUND (PNG STYLE) — Product rendered on a simulated transparent/checkered background, as if the background will be removed. Clean product cutout with subtle shadow beneath for grounding.',
	};

	// Mapas para novas opções de personalização
	const nameSizeMap: Record<string, string> = {
		pequeno: 'Small - approximately 60% of logo width, subtle and elegant',
		medio: 'Medium - approximately 80% of logo width, balanced visibility',
		grande:
			'Large - approximately 100% of logo width or larger, prominent and bold',
	};

	const logoOrientationMap: Record<string, string> = {
		horizontal:
			'HORIZONTAL (Landscape) - logo is wider than tall, normal reading orientation',
		vertical:
			'VERTICAL (Portrait/Upright) - logo is rotated 90° to be taller than wide, standing upright',
	};

	const nameOrientationMap: Record<string, string> = {
		horizontal: 'HORIZONTAL - text reads left to right normally',
		vertical:
			'VERTICAL - text is rotated 90° to read from bottom to top (standing upright)',
	};

	// Mapa completo de fontes com descrições detalhadas
	const fontMap: Record<string, string> = {
		// Sans-serif - Modernas
		arial: 'Arial (sans-serif, clean and modern)',
		helvetica: 'Helvetica (sans-serif, classic and professional)',
		roboto: 'Roboto (sans-serif, modern and geometric)',
		'open-sans': 'Open Sans (sans-serif, friendly and readable)',
		montserrat: 'Montserrat (sans-serif, elegant and contemporary)',
		lato: 'Lato (sans-serif, warm and stable)',
		poppins: 'Poppins (sans-serif, geometric and friendly)',
		raleway: 'Raleway (sans-serif, elegant and refined)',
		nunito: 'Nunito (sans-serif, rounded and friendly)',
		ubuntu: 'Ubuntu (sans-serif, modern and unique)',
		'work-sans': 'Work Sans (sans-serif, professional and clean)',
		inter: 'Inter (sans-serif, optimized for screens)',
		'segoe-ui': 'Segoe UI (sans-serif, modern Windows style)',
		verdana: 'Verdana (sans-serif, highly legible)',
		tahoma: 'Tahoma (sans-serif, compact and clear)',

		// Serifadas - Clássicas
		times: 'Times New Roman (serif, classic and elegant)',
		georgia: 'Georgia (serif, elegant and readable)',
		palatino: 'Palatino (serif, humanist and elegant)',
		garamond: 'Garamond (serif, timeless and refined)',
		baskerville: 'Baskerville (serif, transitional and elegant)',
		'book-antiqua': 'Book Antiqua (serif, classic and readable)',
		merriweather: 'Merriweather (serif, pleasant and readable)',
		'playfair-display': 'Playfair Display (serif, high contrast and elegant)',
		lora: 'Lora (serif, well-balanced and versatile)',
		'crimson-text': 'Crimson Text (serif, bookish and elegant)',
		'libre-baskerville': 'Libre Baskerville (serif, classic and readable)',

		// Script/Cursiva - Elegantes
		'brush-script': 'Brush Script (script, handwritten and elegant)',
		'dancing-script': 'Dancing Script (script, casual and playful)',
		pacifico: 'Pacifico (script, friendly and rounded)',
		lobster: 'Lobster (script, bold and decorative)',
		'great-vibes': 'Great Vibes (script, elegant and flowing)',
		satisfy: 'Satisfy (script, casual and friendly)',
		kalam: 'Kalam (handwriting, casual and informal)',
		'indie-flower': 'Indie Flower (handwriting, delicate and whimsical)',
		caveat: 'Caveat (handwriting, casual and natural)',
		'amatic-sc': 'Amatic SC (handwriting, condensed and bold)',
		allura: 'Allura (script, elegant and sophisticated)',
		sacramento: 'Sacramento (script, elegant and flowing)',
		parisienne: 'Parisienne (script, elegant and refined)',
		'alex-brush': 'Alex Brush (script, elegant and flowing)',

		// Display/Impactantes
		impact: 'Impact (display, bold and condensed)',
		'arial-black': 'Arial Black (display, heavy and bold)',
		oswald: 'Oswald (display, condensed and bold)',
		'bebas-neue': 'Bebas Neue (display, bold and condensed)',
		'russo-one': 'Russo One (display, strong and bold)',
		anton: 'Anton (display, heavy and bold)',
		righteous: 'Righteous (display, rounded and bold)',
		orbitron: 'Orbitron (display, futuristic and geometric)',
		rajdhani: 'Rajdhani (display, modern and geometric)',

		// Handwriting - Manuscritas
		'comic-sans': 'Comic Sans (handwriting, casual and friendly)',
		handlee: 'Handlee (handwriting, casual and natural)',
		'permanent-marker': 'Permanent Marker (handwriting, bold marker style)',
		'rock-salt': 'Rock Salt (handwriting, casual and natural)',
		'patrick-hand': 'Patrick Hand (handwriting, casual and friendly)',

		// Elegantes e Sofisticadas
		cormorant: 'Cormorant (serif, elegant and refined)',
		cinzel: 'Cinzel (serif, classical and elegant)',
		prata: 'Prata (serif, elegant and sophisticated)',
		lusitana: 'Lusitana (serif, elegant and readable)',

		// Monospace
		courier: 'Courier New (monospace, typewriter style)',
		monaco: 'Monaco (monospace, technical and clean)',

		// Designer/Custom (mantém compatibilidade)
		designer: 'Designer (display, bold and modern geometric style)',
	};

	const lines: string[] = [];

	// Verifica se é apenas texto (sem logo)
	const isTextOnly = laserSettings?.apenasTexto === true;

	lines.push(`╔════════════════════════════════════════════════════════════╗`);
	lines.push(`║  TASK: Generate Photorealistic Laser Engraving Preview    ║`);
	lines.push(`║  Product: ${productName.padEnd(46)}║`);
	lines.push(`╚════════════════════════════════════════════════════════════╝`);
	lines.push('');

	if (isTextOnly) {
		// MODO APENAS TEXTO - SEM LOGO
		lines.push('🔤 MODE: TEXT-ONLY ENGRAVING (NO LOGO)');
		lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		lines.push('');
		lines.push('📦 INPUT IMAGES STRUCTURE:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ [1] imageproduct  = Main product photo                  │');
		lines.push('│                     (PRESERVE all colors/lighting)      │');
		if (hasWatermark) {
			lines.push('│                                                         │');
			lines.push('│ [2] watermark     = Company branding overlay            │');
			lines.push('│                     (place in 2 corners as overlay)     │');
		}
		lines.push('│                                                         │');
		lines.push('│ 🚨 NO LOGO IMAGE - ENGRAVE TEXT ONLY                    │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
		lines.push('⚠️ CRITICAL - TEXT-ONLY MODE RULES:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ • DO NOT add any logo or image to the engraving        │');
		lines.push('│ • ONLY engrave the specified TEXT on the product       │');
		lines.push('│ • The engraving should contain ONLY the text provided  │');
		lines.push('│ • NO symbols, icons, or decorative elements            │');
		lines.push('│ • JUST THE TEXT - nothing more                         │');
		lines.push('└─────────────────────────────────────────────────────────┘');
	} else {
		lines.push('📦 INPUT IMAGES STRUCTURE:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ [1] imageproduct  = Main product photo                  │');
		lines.push('│                     (PRESERVE all colors/lighting)      │');
		lines.push('│                                                         │');
		lines.push('│ [2] imagelogo     = Logo to engrave                     │');
		lines.push('│                     (convert to metallic effect)        │');
		if (hasWatermark) {
			lines.push('│                                                         │');
			lines.push('│ [3] watermark     = Company branding overlay            │');
			lines.push('│                     (place in 2 corners as overlay)     │');
		}
		lines.push('└─────────────────────────────────────────────────────────┘');
	}
	lines.push('');
	lines.push('🚨 CRITICAL - OUTPUT DIMENSIONS REQUIREMENT:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ OUTPUT: 1024x1024 photographic quality.                 │');
	lines.push('│ Framing/angle/lighting follow the laserSettings:        │');
	lines.push('│   tipoVisualizacao, anguloCamera, iluminacao, fundoCena │');
	lines.push('│                                                         │');
	lines.push('│ • Use imageproduct only as visual reference for the     │');
	lines.push('│   product itself (material, shape, colors of base)      │');
	lines.push('│ • Compose the final scene from laserSettings, NOT from  │');
	lines.push('│   the imageproduct background                            │');
	lines.push('│ • Output a fresh, clean studio-quality render            │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	lines.push('🚨 ABSOLUTE RULE: ZERO COLORS IN ENGRAVING - METALLIC ONLY');
	lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	lines.push('');
	lines.push('⚠️ FUNDAMENTAL LASER PHYSICS:');
	lines.push('• Laser engraving = PHYSICAL DEPTH/RELIEF in material surface');
	lines.push('• Creates metallic appearance through depth contrast');
	lines.push('• IMPOSSIBLE to produce colors - only depth variations');
	lines.push('• Result MUST simulate real stainless steel (inox) engraving');
	lines.push('• Metallic tones ONLY: silver, gray, or dark metallic black');
	lines.push('');
	lines.push('❌ STRICTLY FORBIDDEN (NEVER ALLOWED):');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ ✗ NO colored pixels (red, blue, green, yellow, etc.)   │');
	lines.push('│ ✗ NO color gradients or color transitions              │');
	lines.push('│ ✗ NO colored logos, text, or decorative elements       │');
	lines.push('│ ✗ NO printed/painted appearance                        │');
	lines.push('│ ✗ NO multi-color designs or color variations           │');
	lines.push('│ ✗ NO RGB color values except grayscale metallic        │');
	lines.push('│ ✗ NO artistic interpretation that adds colors          │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('✅ MANDATORY REQUIREMENTS (ONLY ALLOWED):');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ ✓ Stainless steel metallic effect (inox appearance)    │');
	lines.push('│ ✓ ONE uniform metallic tone throughout entire logo     │');
	lines.push('│ ✓ Realistic laser-engraved texture with depth/relief   │');
	lines.push('│ ✓ Monochrome metallic finish - authentic inox look     │');
	lines.push('│ ✓ High contrast between engraved and non-engraved      │');
	lines.push('│ ✓ Professional industrial engraving appearance         │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('🔄 MANDATORY COLOR CONVERSION ALGORITHM:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ STEP 1: Analyze imageproduct surface color             │');
	lines.push('│         → Dark surface? Use light metallic silver      │');
	lines.push('│         → Light surface? Use dark metallic gray/black  │');
	lines.push('│                                                         │');
	lines.push('│ STEP 2: Strip 100% of colors from imagelogo            │');
	lines.push('│         → Remove ALL RGB color information              │');
	lines.push('│         → Convert to pure grayscale structure           │');
	lines.push('│                                                         │');
	lines.push('│ STEP 3: Apply uniform metallic tone                    │');
	lines.push('│         Dark surface → Silver tones:                    │');
	lines.push('│         • Primary: #C0C0C0 (silver)                     │');
	lines.push('│         • Variation: #B0B0B0 to #D0D0D0                 │');
	lines.push('│         • Effect: Bright engraving on dark background   │');
	lines.push('│                                                         │');
	lines.push('│         Light surface → Dark metallic:                  │');
	lines.push('│         • Primary: #333333 (dark gray)                  │');
	lines.push('│         • Variation: #000000 to #444444                 │');
	lines.push('│         • Effect: Dark engraving on light background    │');
	lines.push('│                                                         │');
	lines.push('│ STEP 4: Ensure uniform metallic appearance             │');
	lines.push('│         → ENTIRE logo = SAME metallic color             │');
	lines.push('│         → NO color gradients or variations              │');
	lines.push('│         → Consistent tone throughout design             │');
	lines.push('│                                                         │');
	lines.push('│ STEP 5: Add realistic engraving texture                │');
	lines.push('│         → Subtle edge highlights for depth perception  │');
	lines.push('│         → Slight shadow/depth effect around edges       │');
	lines.push('│         → Matte metallic finish (not glossy)            │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('🔍 PRE-OUTPUT VERIFICATION CHECKLIST:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ [✓] Logo contains ZERO colored pixels                  │');
	lines.push('│ [✓] Only metallic silver/gray/black tones present      │');
	lines.push('│ [✓] No red, blue, green, yellow, or other colors       │');
	lines.push('│ [✓] Uniform metallic tone throughout entire logo       │');
	lines.push('│ [✓] Realistic engraved texture applied                 │');
	lines.push('│ [✓] High contrast with product surface                 │');
	lines.push('│ [✓] Professional industrial appearance                 │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('⚡ IF VERIFICATION FAILS:');
	lines.push('• Detect ANY colored pixel → Output is INVALID');
	lines.push('• Regenerate with 100% metallic conversion');
	lines.push('• Do NOT proceed with colored output under ANY circumstance');
	lines.push('');
	lines.push('🎯 QUALITY STANDARDS:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ 1. EDGE SHARPNESS:                                      │');
	lines.push('│    • Vector-quality sharp edges (crisp and clean)      │');
	lines.push('│    • No blurry or pixelated edges                       │');
	lines.push('│    • Professional precision throughout                  │');
	lines.push('│                                                         │');
	lines.push('│ 2. DETAIL PRESERVATION:                                │');
	lines.push('│    • ALL logo details preserved exactly                 │');
	lines.push('│    • Text remains legible and clear                     │');
	lines.push('│    • Maintain original proportions and spacing          │');
	lines.push('│    • Fine lines minimum 0.3mm thickness                 │');
	lines.push('│                                                         │');
	lines.push('│ 3. TEXTURE REALISM:                                     │');
	lines.push('│    • Authentic laser-engraved appearance                │');
	lines.push('│    • Subtle depth/relief effect                         │');
	lines.push('│    • Matte metallic finish (industrial quality)         │');
	lines.push('│    • NOT painted or printed look                        │');
	lines.push('│                                                         │');
	lines.push('│ 4. COMPOSITION ACCURACY:                                │');
	lines.push('│    • Framing from tipoVisualizacao setting              │');
	lines.push('│    • Camera angle from anguloCamera setting             │');
	lines.push('│    • Lighting from iluminacao setting                   │');
	lines.push('│    • Background from fundoCena setting                  │');
	lines.push('│    • Output: 1024x1024 high-quality render              │');
	lines.push('│    • Remove any pre-existing engravings completely      │');
	lines.push('│                                                         │');
	lines.push('│ 5. CONTRAST OPTIMIZATION:                               │');
	lines.push('│    • Maximum visibility on product surface              │');
	lines.push('│    • Clear separation from background                   │');
	lines.push('│    • Professional legibility at intended size           │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('🔧 ACCESSORIES HANDLING (Bottle Openers/Abridores):');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ IF bottle opener/abridor is visible in product:        │');
	lines.push('│                                                         │');
	lines.push('│ ✓ Apply SAME logo to opener surface                    │');
	lines.push('│                                                         │');
	lines.push('│ ✓ CRITICAL: Logo orientation on opener:                │');
	lines.push('│   → Must be UPRIGHT/NORMAL (orientation de pé)         │');
	lines.push('│   → NOT inverted, NOT rotated, NOT flipped             │');
	lines.push('│   → Readable normally when opener is in use position   │');
	lines.push('│                                                         │');
	lines.push('│ ✓ CRITICAL: Metallic color on opener:                  │');
	lines.push('│   → Same metallic inox effect as main product          │');
	lines.push('│   → NO COLORS ALLOWED on opener logo                   │');
	lines.push('│   → Stainless steel silver/gray ONLY                   │');
	lines.push('│   → Apply same color conversion rules                  │');
	lines.push('│                                                         │');
	lines.push('│ ✓ Quality standards for accessories:                   │');
	lines.push('│   → Same sharpness and detail as main logo             │');
	lines.push('│   → Excellent contrast and visibility                  │');
	lines.push('│   → Professional engraving appearance                  │');
	lines.push('│   → Proportional sizing to accessory surface           │');
	lines.push('│                                                         │');
	lines.push('│ ✓ Both logos (product + opener):                       │');
	lines.push('│   → Same uniform metallic tone                         │');
	lines.push('│   → NO colors on either surface                        │');
	lines.push('│   → Consistent quality and appearance                  │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	const sizeDescription = sizeMap[laserSettings.tamanho] ?? sizeMap.medio;
	const positionDescription =
		positionMap[laserSettings.posicao] ?? positionMap.central;
	const intensityDescription =
		intensityMap[laserSettings.intensidade] ?? intensityMap.media;
	const depthDescription =
		depthMap[laserSettings.profundidade] ?? depthMap.media;
	const logoOrientationDescription =
		logoOrientationMap[laserSettings.orientacaoLogo] ??
		logoOrientationMap.horizontal;

	// Resoluções para tipo de prévia / registro fotográfico
	const tipoVisualizacaoDescription =
		tipoVisualizacaoMap[laserSettings.tipoVisualizacao] ??
		tipoVisualizacaoMap['frontal-padrao'];
	const anguloCameraDescription =
		anguloCameraMap[laserSettings.anguloCamera] ?? anguloCameraMap.frontal;
	const iluminacaoDescription =
		iluminacaoMap[laserSettings.iluminacao] ?? iluminacaoMap['studio-softbox'];
	const fundoCenaDescription =
		fundoCenaMap[laserSettings.fundoCena] ?? fundoCenaMap['cinza-gradiente'];
	const is360 = laserSettings.tipoVisualizacao === '360';
	const isMultiAngulo = laserSettings.tipoVisualizacao === 'multi-angulo';
	const isComposite = is360 || isMultiAngulo;

	lines.push('📐 ENGRAVING SPECIFICATIONS:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(`│ Size:       ${sizeDescription.padEnd(42)}│`);
	lines.push(`│ Position:   ${positionDescription.padEnd(42)}│`);
	lines.push(`│ Intensity:  ${intensityDescription.padEnd(42)}│`);
	lines.push(`│ Depth:      ${depthDescription.padEnd(42)}│`);

	const rotation =
		typeof laserSettings.rotacao === 'number'
			? laserSettings.rotacao
			: Number.parseInt(String(laserSettings.rotacao ?? '0'), 10);
	if (!Number.isNaN(rotation) && rotation !== 0) {
		const rotationDesc = `${rotation}° ${rotation > 0 ? 'clockwise' : 'counter-clockwise'}`;
		lines.push(`│ Rotation:   ${rotationDesc.padEnd(42)}│`);
	}

	// Sempre incluir informação da fonte selecionada
	const fontDescription = fontMap[laserSettings.fonteFamilia] ?? fontMap.arial;
	lines.push(`│ Font Style: ${fontDescription.padEnd(42)}│`);
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Seção de Material e Superfície
	const materialDescription =
		materialMap[laserSettings.material] ?? materialMap['aco-inox'];
	const finishDescription =
		finishMap[laserSettings.acabamentoSuperficie] ?? finishMap.fosco;
	const contrasteValue = laserSettings.contraste ?? 50;
	const sombraValue = laserSettings.efeitoSombra ?? 30;

	lines.push('🏗️ MATERIAL & SURFACE PROPERTIES:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(
		`│ Material:       ${materialDescription.substring(0, 40).padEnd(40)}│`,
	);
	lines.push(
		`│ Surface Finish: ${finishDescription.substring(0, 40).padEnd(40)}│`,
	);
	lines.push(`│ Contrast Level: ${String(contrasteValue).padEnd(40)}│`);
	lines.push(`│ Shadow/Depth:   ${String(sombraValue).padEnd(40)}│`);
	lines.push('│                                                         │');
	lines.push('│ MATERIAL-SPECIFIC ENGRAVING RULES:                     │');

	const materialType = laserSettings.material ?? 'aco-inox';
	if (materialType === 'madeira') {
		lines.push('│ → Wood engraving: darker burned/charred tone            │');
		lines.push('│ → Show wood grain texture visible through engraving     │');
		lines.push('│ → Brown-black burned appearance (not metallic)          │');
		lines.push('│ → Depth creates contrast through color darkening        │');
	} else if (materialType === 'couro') {
		lines.push('│ → Leather engraving: lighter embossed/debossed mark     │');
		lines.push('│ → Show leather texture around engraving edges           │');
		lines.push('│ → Contrast through pressed/indented appearance          │');
		lines.push('│ → Subtle tonal shift from surrounding leather           │');
	} else if (materialType === 'acrilico') {
		lines.push('│ → Acrylic engraving: frosted white etch on surface      │');
		lines.push('│ → Clean precise lines with frosted glass appearance     │');
		lines.push('│ → Semi-transparent depth effect where engraved          │');
		lines.push('│ → Modern clean aesthetic                                │');
	} else if (materialType === 'vidro') {
		lines.push('│ → Glass etching: frosted translucent mark               │');
		lines.push('│ → Delicate sandblasted/etched appearance                │');
		lines.push('│ → Subtle opacity change where engraved                  │');
		lines.push('│ → Elegant and refined finish                            │');
	} else if (materialType === 'tecido') {
		lines.push('│ → Fabric marking: embroidered or heat-transfer look     │');
		lines.push('│ → Visible thread/weave texture around marking           │');
		lines.push('│ → Subtle pressed/imprinted appearance on soft surface   │');
		lines.push('│ → Clean contrast between mark and fabric background     │');
	} else {
		lines.push('│ → Metal engraving: metallic silver/gray/black tones     │');
		lines.push('│ → Stainless steel (inox) reflective appearance          │');
		lines.push('│ → Professional industrial metallic finish               │');
		lines.push('│ → High contrast between engraved and polished areas     │');
	}
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Seção de Estilo de Gravação
	const styleDescription =
		styleMap[laserSettings.estiloGravacao] ?? styleMap.clean;
	lines.push('🎨 ENGRAVING STYLE:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(`│ Style: ${styleDescription.substring(0, 49).padEnd(49)}│`);
	lines.push('│                                                         │');
	lines.push('│ Apply style characteristics to ALL engraved elements:  │');
	lines.push('│ → Logo, text, borders, and decorative elements         │');
	lines.push('│ → Style affects edge treatment, texture, depth look    │');
	lines.push('│ → Maintain consistency across entire engraving         │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Seção de Moldura (condicional)
	const frameDescription = frameMap[laserSettings.moldura] ?? frameMap.nenhuma;
	if (laserSettings.moldura && laserSettings.moldura !== 'nenhuma') {
		lines.push('🖼️ BORDER/FRAME:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push(`│ Frame: ${frameDescription.substring(0, 49).padEnd(49)}│`);
		lines.push('│                                                         │');
		lines.push('│ → Frame uses same engraving effect as logo              │');
		lines.push('│ → Frame encloses complete engraving area (logo + text) │');
		lines.push('│ → Consistent tone and depth with main engraving        │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	// Seção de Contraste e Sombra
	lines.push('💡 CONTRAST & DEPTH EFFECTS:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(
		`│ Contrast Level: ${contrasteValue}%${' '.repeat(Math.max(0, 39 - String(contrasteValue).length))}│`,
	);
	lines.push('│   0%=very subtle, 50%=balanced, 100%=maximum separation│');
	lines.push('│                                                         │');
	lines.push(
		`│ Shadow/Depth Intensity: ${sombraValue}%${' '.repeat(Math.max(0, 32 - String(sombraValue).length))}│`,
	);
	lines.push('│   0%=flat no depth, 50%=moderate relief, 100%=deep 3D  │');
	lines.push('│   Light source direction: upper-left (consistent)      │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Seção de orientação da logo
	lines.push('');
	lines.push('🔄 LOGO ORIENTATION SPECIFICATION:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(
		`│ Logo Orientation: ${logoOrientationDescription.substring(0, 38).padEnd(38)}│`,
	);
	lines.push('│                                                         │');
	if (laserSettings.orientacaoLogo === 'vertical') {
		lines.push('│ ⚠️ CRITICAL - VERTICAL ORIENTATION RULES:               │');
		lines.push('│    → Rotate logo 90° counter-clockwise                 │');
		lines.push('│    → Logo should stand UPRIGHT (taller than wide)      │');
		lines.push('│    → Text in logo reads from bottom to top             │');
		lines.push('│    → Maintain original logo proportions after rotation │');
		lines.push('│    → Logo appears as if standing on its side           │');
		lines.push('│                                                         │');
		lines.push('│    Visual representation:                               │');
		lines.push('│    HORIZONTAL: [====LOGO====]                          │');
		lines.push('│    VERTICAL:   ║ L ║                                   │');
		lines.push('│                ║ O ║                                   │');
		lines.push('│                ║ G ║                                   │');
		lines.push('│                ║ O ║                                   │');
	} else {
		lines.push('│ ✓ HORIZONTAL ORIENTATION (DEFAULT):                    │');
		lines.push('│    → Logo maintains normal reading orientation          │');
		lines.push('│    → Logo is wider than tall (landscape)                │');
		lines.push('│    → Text reads left to right normally                  │');
		lines.push('│    → Standard placement without rotation                │');
	}
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Adicionar seção sobre o estilo de fonte aplicado
	lines.push('🔤 FONT/STYLE SPECIFICATIONS:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ Selected Font Style:                                    │');
	lines.push(`│   ${fontDescription.padEnd(56)}│`);
	lines.push('│                                                         │');
	lines.push('│ ⚠️ CRITICAL - Font Application Rules:                   │');
	lines.push('│                                                         │');
	lines.push('│ 1. LOGO TEXT ELEMENTS (if any):                        │');
	lines.push('│    → Apply this font style to ALL text within logo     │');
	lines.push("│    → Maintain font's visual characteristics            │");
	lines.push('│    → Preserve font weight, spacing, and style          │');
	lines.push('│                                                         │');
	if (hasCustomName && customName) {
		lines.push('│ 2. CUSTOM PERSONALIZED NAME TEXT:                      │');
		lines.push(`│    → Text "${customName}" MUST use this exact font      │`);
		lines.push('│    → Apply font style consistently throughout text    │');
		lines.push('│    → Maintain proper letter spacing and kerning       │');
		lines.push('│                                                         │');
	}
	lines.push('│ 3. FONT STYLE CHARACTERISTICS:                          │');
	const fontValue = laserSettings.fonteFamilia ?? 'arial';
	if (
		fontValue.includes('script') ||
		fontValue.includes('cursive') ||
		fontValue.includes('brush') ||
		fontValue.includes('dancing') ||
		fontValue.includes('vibes') ||
		fontValue.includes('pacifico') ||
		fontValue.includes('lobster') ||
		fontValue.includes('allura') ||
		fontValue.includes('sacramento') ||
		fontValue.includes('parisienne') ||
		fontValue.includes('alex-brush')
	) {
		lines.push('│    → This is a SCRIPT/CURSIVE font - elegant flowing style│');
		lines.push('│    → Maintain cursive connections and fluid strokes    │');
		lines.push('│    → Preserve elegant and sophisticated appearance     │');
	} else if (
		fontValue.includes('serif') ||
		fontValue.includes('times') ||
		fontValue.includes('georgia') ||
		fontValue.includes('garamond') ||
		fontValue.includes('baskerville') ||
		fontValue.includes('merriweather') ||
		fontValue.includes('playfair') ||
		fontValue.includes('lora') ||
		fontValue.includes('crimson') ||
		fontValue.includes('cormorant') ||
		fontValue.includes('cinzel')
	) {
		lines.push('│    → This is a SERIF font - classic and elegant        │');
		lines.push('│    → Maintain serif details and traditional style      │');
		lines.push('│    → Preserve elegant and refined appearance           │');
	} else if (
		fontValue.includes('display') ||
		fontValue.includes('impact') ||
		fontValue.includes('oswald') ||
		fontValue.includes('bebas') ||
		fontValue.includes('russo') ||
		fontValue.includes('anton') ||
		fontValue.includes('righteous') ||
		fontValue.includes('orbitron')
	) {
		lines.push('│    → This is a DISPLAY font - bold and impactful       │');
		lines.push('│    → Maintain bold weight and strong presence          │');
		lines.push('│    → Preserve impactful and attention-grabbing style   │');
	} else if (
		fontValue.includes('handwriting') ||
		fontValue.includes('handlee') ||
		fontValue.includes('permanent-marker') ||
		fontValue.includes('rock-salt') ||
		fontValue.includes('patrick-hand') ||
		fontValue.includes('comic')
	) {
		lines.push('│    → This is a HANDWRITING font - casual and natural   │');
		lines.push('│    → Maintain handwritten appearance and natural flow  │');
		lines.push('│    → Preserve casual and friendly style                │');
	} else {
		lines.push('│    → This is a SANS-SERIF font - modern and clean      │');
		lines.push('│    → Maintain clean lines and modern appearance        │');
		lines.push('│    → Preserve professional and contemporary style      │');
	}
	lines.push('│                                                         │');
	lines.push('│ 4. METALLIC EFFECT WITH FONT:                           │');
	lines.push('│    → Font style applies to METALLIC inox engraving only │');
	lines.push('│    → Text remains metallic (silver/gray/black)          │');
	lines.push('│    → Font characteristics visible through engraving depth│');
	lines.push('│    → NO colors - only metallic tones with font style     │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Adicionar detalhes visuais de posicionamento
	lines.push('🎯 CRITICAL - EXACT LOGO POSITIONING:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	const posDetails =
		positionDetailMap[laserSettings.posicao] || positionDetailMap.central;
	for (const line of posDetails) {
		lines.push(line);
	}
	lines.push('│                                                         │');
	lines.push('│ ⚠️ PLACEMENT MUST BE PRECISE - NOT APPROXIMATE          │');
	lines.push('│    Follow the percentages/coordinates EXACTLY           │');
	lines.push('│    Deviations make the preview look unprofessional      │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Adicionar diagrama visual de posicionamento
	lines.push('📊 VISUAL POSITIONING GUIDE:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│         PRODUCT SURFACE GRID                           │');
	lines.push('│                                                         │');
	lines.push('│   ┌───────────────────────────────────┐                 │');
	lines.push('│   │        SUPERIOR (top 33%)         │ ← top area      │');
	lines.push('│   │           15-25% from top         │                 │');
	lines.push('│   ├───────────────────────────────────┤                 │');
	lines.push('│   │                                   │                 │');
	lines.push('│   │        CENTRAL (middle 33%)       │ ← center area   │');
	lines.push('│   │           50% from top            │                 │');
	lines.push('│   │                                   │                 │');
	lines.push('│   ├───────────────────────────────────┤                 │');
	lines.push('│   │        INFERIOR (bottom 33%)      │ ← bottom area   │');
	lines.push('│   │           70-85% from top         │                 │');
	lines.push('│   └───────────────────────────────────┘                 │');
	lines.push('│                                                         │');
	if (laserSettings.posicao === 'central') {
		lines.push('│   🎯 SELECTED: CENTER - Logo at exact center point     │');
	} else if (laserSettings.posicao === 'superior') {
		lines.push('│   🎯 SELECTED: SUPERIOR - Logo in TOP area             │');
	} else if (laserSettings.posicao === 'inferior') {
		lines.push('│   🎯 SELECTED: INFERIOR - Logo in BOTTOM area          │');
	} else if (laserSettings.posicao === 'lateral') {
		lines.push('│   🎯 SELECTED: LATERAL - Logo offset to SIDE           │');
	}
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// Adicionar guia de tamanho relativo
	lines.push('📏 SIZE REFERENCE GUIDE:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ Logo size is RELATIVE to the engravable surface:       │');
	lines.push('│                                                         │');
	if (laserSettings.tamanho === 'pequeno') {
		lines.push('│   SMALL: Logo occupies ~15-20% of surface              │');
		lines.push('│   ┌─────────────────────┐                               │');
		lines.push('│   │                     │                               │');
		lines.push('│   │      ┌───┐          │  ← Small logo                 │');
		lines.push('│   │      └───┘          │    (discreet)                 │');
		lines.push('│   │                     │                               │');
		lines.push('│   └─────────────────────┘                               │');
	} else if (laserSettings.tamanho === 'medio') {
		lines.push('│   MEDIUM: Logo occupies ~30-40% of surface             │');
		lines.push('│   ┌─────────────────────┐                               │');
		lines.push('│   │                     │                               │');
		lines.push('│   │    ┌─────────┐      │  ← Medium logo                │');
		lines.push('│   │    │         │      │    (balanced)                 │');
		lines.push('│   │    └─────────┘      │                               │');
		lines.push('│   │                     │                               │');
		lines.push('│   └─────────────────────┘                               │');
	} else if (laserSettings.tamanho === 'grande') {
		lines.push('│   LARGE: Logo occupies ~50-60% of surface              │');
		lines.push('│   ┌─────────────────────┐                               │');
		lines.push('│   │  ┌───────────────┐  │                               │');
		lines.push('│   │  │               │  │  ← Large logo                 │');
		lines.push('│   │  │               │  │    (prominent)                │');
		lines.push('│   │  └───────────────┘  │                               │');
		lines.push('│   └─────────────────────┘                               │');
	} else {
		lines.push('│   CUSTOM: Logo sized proportionally (~40%)             │');
	}
	lines.push('│                                                         │');
	lines.push('│ ⚠️ IMPORTANT: Maintain logo aspect ratio (no stretch)   │');
	lines.push('│    Scale uniformly - width and height proportional      │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	// ─── Photography / Visualization Type ────────────────────────────────────
	lines.push('📸 PHOTOGRAPHY / VISUALIZATION TYPE:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push(
		`│ Style: ${(laserSettings.tipoVisualizacao ?? 'frontal-padrao').padEnd(49)}│`,
	);
	lines.push('│                                                         │');
	const tipoLines = tipoVisualizacaoDescription.match(/.{1,53}/g) ?? [];
	for (const chunk of tipoLines) {
		lines.push(`│ ${chunk.padEnd(55)}│`);
	}
	lines.push('│                                                         │');
	lines.push(
		`│ Camera:    ${anguloCameraDescription.substring(0, 44).padEnd(44)}│`,
	);
	lines.push(
		`│ Lighting:  ${iluminacaoDescription.substring(0, 44).padEnd(44)}│`,
	);
	lines.push(
		`│ Background:${fundoCenaDescription.substring(0, 44).padEnd(44)}│`,
	);
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');

	if (isComposite) {
		lines.push('⚠️ COMPOSITE IMAGE — CRITICAL LAYOUT REQUIREMENTS:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		if (is360) {
			lines.push('│ CREATE A SINGLE 2×3 GRID IMAGE with 6 panels:          │');
			lines.push('│   Row 1: [FRONT]          [BACK]                        │');
			lines.push('│   Row 2: [LEFT]           [RIGHT]                       │');
			lines.push('│   Row 3: [TOP]            [45°]                         │');
			lines.push('│                                                         │');
			lines.push('│ • Each panel: SAME product + SAME engraving             │');
			lines.push('│ • Consistent lighting across all 6 panels               │');
			lines.push('│ • Thin gray (#CCCCCC) dividers between panels           │');
			lines.push('│ • Small white label below each panel (FRONT, BACK, etc) │');
			lines.push('│ • Output is ONE single image — portrait aspect ratio    │');
		} else {
			lines.push('│ CREATE A SINGLE 2×2 GRID IMAGE with 4 panels:          │');
			lines.push('│   Row 1: [FRONT]          [3/4 LEFT]                    │');
			lines.push('│   Row 2: [3/4 RIGHT]      [OVERHEAD]                    │');
			lines.push('│                                                         │');
			lines.push('│ • Each panel: SAME product + SAME engraving             │');
			lines.push('│ • Consistent lighting across all 4 panels               │');
			lines.push('│ • Thin gray (#CCCCCC) dividers between panels           │');
			lines.push('│ • Small white label below each panel                    │');
			lines.push('│ • Output is ONE single image — square (1:1) aspect ratio│');
		}
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	if (laserSettings.tipoVisualizacao === 'closeup-gravacao') {
		lines.push('🔍 MACRO CLOSE-UP REQUIREMENTS:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ • Engraving area fills 70-80% of total image frame      │');
		lines.push('│ • Focus razor-sharp on engraved lines and texture       │');
		lines.push('│ • Show micro-scale relief, burn marks, and depth        │');
		lines.push('│ • Apply shallow depth of field (bokeh on background)    │');
		lines.push('│ • Full product silhouette NOT required — ONLY engraving │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	if (laserSettings.tipoVisualizacao === 'render-3d') {
		lines.push('💎 3D RENDER STYLE REQUIREMENTS:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ • CGI / photorealistic render quality                   │');
		lines.push('│ • HDRI studio lighting with realistic reflections       │');
		lines.push('│ • Ray-traced shadows and specular highlights            │');
		lines.push('│ • Perfect surface materials (metal, leather, wood, etc) │');
		lines.push('│ • Hyperrealistic quality exceeding real photography     │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	if (laserSettings.tipoVisualizacao === 'fotogravacao') {
		lines.push('🖼️ PHOTO ENGRAVING (FOTOGRAVAÇÃO) REQUIREMENTS:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ • Logo rendered as HALFTONE PHOTO ENGRAVING on surface  │');
		lines.push('│ • Dark tones = dense deep laser dots, light = sparse    │');
		lines.push('│ • Visible halftone dot/line grid texture across image   │');
		lines.push('│ • Depth variation: shadows deeper, highlights shallow   │');
		lines.push('│ • Result looks like photograph BURNED into material     │');
		lines.push('│ • Entire engraving = metallic tones ONLY (zero color)   │');
		lines.push('│ • Preserve fine photographic detail in engraving marks  │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	if (hasCustomName && customName) {
		const nameSizeDescription =
			nameSizeMap[laserSettings.tamanhoNome] ?? nameSizeMap.medio;
		const nameOrientationDescription =
			nameOrientationMap[laserSettings.orientacaoNome] ??
			nameOrientationMap.horizontal;

		lines.push('✍️ CUSTOM PERSONALIZED TEXT:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push(`│ Text to engrave: "${customName.padEnd(36)}│`);
		lines.push(`│ Font:            ${fontDescription.padEnd(36)}│`);
		lines.push(
			`│ Text Size:       ${nameSizeDescription.substring(0, 36).padEnd(36)}│`,
		);
		lines.push(
			`│ Text Orientation: ${nameOrientationDescription.substring(0, 35).padEnd(35)}│`,
		);
		lines.push('│                                                         │');
		const textPosDescription =
			textPositionMap[laserSettings.posicaoTextoRelLogo] ??
			textPositionMap.abaixo;
		const spacingDescription =
			spacingMap[laserSettings.espacamentoLogoTexto] ?? spacingMap.medio;
		lines.push('│ Text positioning:                                       │');
		lines.push(`│   → ${textPosDescription.substring(0, 52).padEnd(52)}│`);
		lines.push(
			`│   → Spacing: ${spacingDescription.substring(0, 42).padEnd(42)}│`,
		);
		lines.push('│   → Maintain legibility and professional appearance     │');
		lines.push('│                                                         │');

		// Adicionar instruções específicas de tamanho do nome
		lines.push('│ 📏 TEXT SIZE SPECIFICATIONS:                            │');
		if (laserSettings.tamanhoNome === 'pequeno') {
			lines.push('│   → SMALL TEXT - subtle and elegant                     │');
			lines.push('│   → Width approximately 60% of logo width               │');
			lines.push('│   → Discreet appearance, complementary to logo          │');
			lines.push('│   → Ideal for long names or secondary personalization   │');
		} else if (laserSettings.tamanhoNome === 'grande') {
			lines.push('│   → LARGE TEXT - prominent and bold                     │');
			lines.push('│   → Width approximately 100% of logo width or larger    │');
			lines.push('│   → High visibility and impact                          │');
			lines.push('│   → Text is a primary visual element                    │');
		} else {
			lines.push('│   → MEDIUM TEXT - balanced visibility                   │');
			lines.push('│   → Width approximately 80% of logo width               │');
			lines.push('│   → Good balance between visibility and elegance        │');
			lines.push('│   → Standard sizing for most personalization            │');
		}
		lines.push('│                                                         │');

		// Adicionar instruções específicas de orientação do nome
		lines.push('│ 🔄 TEXT ORIENTATION SPECIFICATIONS:                     │');
		if (laserSettings.orientacaoNome === 'vertical') {
			lines.push('│   → VERTICAL TEXT - rotated 90° to stand upright        │');
			lines.push('│   → Text reads from bottom to top                       │');
			lines.push('│   → Position text beside the logo (left or right)       │');
			lines.push('│   → Creates a tower/pillar effect with logo             │');
			lines.push('│   → Ideal for cylindrical products (bottles, cups)      │');
			lines.push('│                                                         │');
			lines.push('│   Visual representation:                                │');
			lines.push('│   [LOGO] ║N║                                           │');
			lines.push('│          ║A║                                           │');
			lines.push('│          ║M║                                           │');
			lines.push('│          ║E║                                           │');
		} else {
			lines.push('│   → HORIZONTAL TEXT - normal reading orientation        │');
			lines.push('│   → Text reads left to right below logo                 │');
			lines.push('│   → Standard positioning under the logo                 │');
			lines.push('│   → Classic and professional appearance                 │');
			lines.push('│                                                         │');
			lines.push('│   Visual representation:                                │');
			lines.push('│        [LOGO]                                          │');
			lines.push('│    ═══ NAME ═══                                        │');
		}
		lines.push('│                                                         │');
		lines.push('│ ⚠️ CRITICAL - Text color requirements:                  │');
		lines.push('│   → Text MUST be metallic inox effect                   │');
		lines.push('│   → Use SAME uniform metallic tone as logo              │');
		lines.push('│   → NO COLORS ALLOWED - silver/gray/black ONLY          │');
		lines.push('│   → NO colored text under ANY circumstance              │');
		lines.push('│   → Apply same color conversion rules as logo           │');
		lines.push('│                                                         │');
		lines.push('│ Text quality standards:                                 │');
		lines.push('│   → Sharp, crisp letterforms (vector-quality)           │');
		lines.push('│   → Excellent legibility and readability                │');
		lines.push('│   → Professional engraved appearance                    │');
		lines.push('│   → Consistent stroke width throughout                  │');
		lines.push('│   → Proper spacing and kerning                          │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	// Modo Lentes Duplas (Óculos/Sunglasses)
	if (modoLentes && (textoLenteDireita || textoLenteEsquerda)) {
		lines.push('');
		lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		lines.push('👓 DUAL-LENS ENGRAVING MODE (SUNGLASSES/GLASSES)');
		lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		lines.push('');
		lines.push('⚠️ CRITICAL: This product has TWO SEPARATE lenses requiring');
		lines.push('INDEPENDENT text engraving on each lens.');
		lines.push('');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		if (textoLenteDireita) {
			lines.push(`${`│ RIGHT LENS TEXT: "${textoLenteDireita}"`.padEnd(58)}│`);
		} else {
			lines.push('│ RIGHT LENS: (no text - leave blank/empty)               │');
		}
		if (textoLenteEsquerda) {
			lines.push(`${`│ LEFT LENS TEXT:  "${textoLenteEsquerda}"`.padEnd(58)}│`);
		} else {
			lines.push('│ LEFT LENS: (no text - leave blank/empty)                │');
		}
		lines.push('│                                                         │');
		lines.push('│ CRITICAL PLACEMENT RULES:                               │');
		lines.push('│ • Each text is CENTERED on its respective lens          │');
		lines.push('│ • Text follows the CURVATURE of the lens surface        │');
		lines.push('│ • Both texts use the SAME font, size, and style         │');
		lines.push('│ • Text should be proportional to lens size              │');
		lines.push('│ • Maintain readability and elegance on both lenses       │');
		lines.push('│ • Text appears as laser-engraved (metallic/white)       │');
		lines.push("│ • RIGHT lens = viewer's LEFT when facing the glasses    │");
		lines.push("│ • LEFT lens = viewer's RIGHT when facing the glasses    │");
		lines.push('│ • If only one lens has text, leave the other BLANK      │');
		lines.push('│ • DO NOT add any logo or image - TEXT ONLY on lenses    │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	// Adicionar instruções personalizadas do usuário, se fornecidas
	if (instrucoesPersonalizadas?.trim()) {
		const instrucoesTexto = instrucoesPersonalizadas.trim();

		lines.push('');
		lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		lines.push('🎯 INSTRUÇÕES PERSONALIZADAS DO USUÁRIO - ALTA PRIORIDADE');
		lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		lines.push('');
		lines.push(
			'⚠️ CRITICAL: The instructions below are SPECIFIC USER REQUIREMENTS.',
		);
		lines.push(
			'These instructions have HIGH PRIORITY and should be applied whenever possible.',
		);
		lines.push('');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ USER CUSTOM INSTRUCTIONS:                                │');
		lines.push('├─────────────────────────────────────────────────────────┤');

		// Quebrar instruções em linhas e formatar adequadamente
		const instrucoesLinhas = instrucoesTexto.split('\n');
		instrucoesLinhas.forEach((linha, _index) => {
			const linhaLimpa = linha.trim();
			if (linhaLimpa) {
				// Se a linha for muito longa, quebrar em múltiplas linhas
				if (linhaLimpa.length > 55) {
					const palavras = linhaLimpa.split(' ');
					let linhaAtual = '';
					palavras.forEach((palavra) => {
						if (`${linhaAtual} ${palavra}`.length <= 55) {
							linhaAtual = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
						} else {
							if (linhaAtual) {
								lines.push(`│ ${linhaAtual.padEnd(55)}│`);
							}
							linhaAtual = palavra;
						}
					});
					if (linhaAtual) {
						lines.push(`│ ${linhaAtual.padEnd(55)}│`);
					}
				} else {
					lines.push(`│ ${linhaLimpa.padEnd(55)}│`);
				}
			}
		});

		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
		lines.push('📋 APPLICATION RULES FOR CUSTOM INSTRUCTIONS:');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push('│ 1. PRIORITY: Apply these instructions when feasible     │');
		lines.push('│    → User requirements take precedence over defaults     │');
		lines.push('│    → Implement instructions precisely as requested       │');
		lines.push('│                                                         │');
		lines.push('│ 2. COMPATIBILITY WITH LASER ENGRAVING RULES:            │');
		lines.push('│    → If instruction conflicts with metallic-only rule,  │');
		lines.push('│      adapt instruction to use metallic effects          │');
		lines.push('│    → Maintain laser engraving realism and quality       │');
		lines.push('│    → Preserve professional industrial appearance        │');
		lines.push('│                                                         │');
		lines.push('│ 3. COMMON INSTRUCTION INTERPRETATIONS:                  │');
		lines.push("│    → 'Make darker' = deeper engraving, higher contrast  │");
		lines.push("│    → 'Add depth effect' = stronger relief/shadow effect │");
		lines.push("│    → 'Position top left' = adjust logo position        │");
		lines.push("│    → 'Increase size' = scale up logo proportionally    │");
		lines.push("│    → 'More contrast' = enhance metallic tone contrast  │");
		lines.push('│                                                         │');
		lines.push('│ 4. QUALITY REQUIREMENTS:                                │');
		lines.push('│    → Always maintain engraving quality standards        │');
		lines.push('│    → Ensure instructions enhance, not degrade, quality  │');
		lines.push('│    → If instruction is ambiguous, interpret professionally│');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
		lines.push('✅ VERIFICATION:');
		lines.push('• Review custom instructions before finalizing output');
		lines.push('• Ensure all feasible instructions have been applied');
		lines.push(
			'• Confirm output meets both user requirements and quality standards',
		);
		lines.push('');
	}

	lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	lines.push('🎯 FINAL OUTPUT REQUIREMENTS & VALIDATION');
	lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	lines.push('');
	lines.push('📋 OUTPUT DESCRIPTION:');
	const outputDesc = is360
		? 'COMPOSITE 2×3 grid image showing 6 views (front, back, left, right, top, 45°) of the laser-engraved product.'
		: isMultiAngulo
			? 'COMPOSITE 2×2 grid image showing 4 angles of the laser-engraved product.'
			: laserSettings.tipoVisualizacao === 'closeup-gravacao'
				? 'Extreme macro close-up of the laser engraving area showing microscopic texture detail.'
				: 'Professional photorealistic preview showing laser-engraved logo on product with authentic engraving appearance.';
	lines.push(outputDesc);
	lines.push(
		`Photography style: ${laserSettings.tipoVisualizacao ?? 'frontal-padrao'} | Lighting: ${laserSettings.iluminacao ?? 'studio-softbox'} | Background: ${laserSettings.fundoCena ?? 'cinza-gradiente'}`,
	);
	lines.push('');
	lines.push('✅ MANDATORY FINAL VALIDATION CHECKLIST:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ METALLIC COLOR REQUIREMENTS (CRITICAL):                 │');
	lines.push('│ [✓] Logo on main product = metallic inox ONLY           │');
	lines.push('│     (silver/gray/black tones - ZERO colors)             │');
	lines.push('│                                                         │');
	lines.push('│ [✓] Logo on opener (if visible) = metallic inox ONLY    │');
	lines.push('│     (same metallic tone - ZERO colors)                  │');
	lines.push('│                                                         │');
	lines.push('│ [✓] Custom text (if present) = metallic inox ONLY       │');
	lines.push('│     (same metallic tone - ZERO colors)                  │');
	lines.push('│                                                         │');
	lines.push('│ [✓] ENTIRE engraving = monochrome metallic effect       │');
	lines.push('│     (NO colored pixels anywhere in engraving)           │');
	lines.push('│                                                         │');
	lines.push('│ [✓] Result looks like REAL stainless steel engraving    │');
	lines.push('│     (NOT printed/painted appearance)                    │');
	lines.push('│                                                         │');
	lines.push('│ OUTPUT DIMENSIONS (CRITICAL):                           │');
	lines.push('│ [✓] Output: 1024x1024 photographic quality              │');
	lines.push('│ [✓] Framing from tipoVisualizacao setting               │');
	lines.push('│ [✓] Camera angle from anguloCamera setting              │');
	lines.push('│                                                         │');
	lines.push('│ COMPOSITION PRESERVATION (CRITICAL):                    │');
	lines.push('│ [✓] Product shape/material preserved from imageproduct  │');
	lines.push('│ [✓] Background composed from fundoCena setting          │');
	lines.push('│     (not from the imageproduct background)              │');
	lines.push('│                                                         │');
	lines.push('│ [✓] Logo on opener in upright/normal orientation        │');
	lines.push('│     (readable normally)                                 │');
	lines.push('│                                                         │');
	lines.push('│ QUALITY STANDARDS (CRITICAL):                           │');
	lines.push('│ [✓] Vector-sharp edges throughout                       │');
	lines.push('│ [✓] All details preserved accurately                    │');
	lines.push('│ [✓] Professional industrial appearance                  │');
	lines.push('│ [✓] Excellent contrast and visibility                   │');
	lines.push('│ [✓] Consistent metallic tone across all elements        │');
	lines.push('│ [✓] Authentic engraved texture (depth/relief)           │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('❌ OUTPUT REJECTION CRITERIA:');
	lines.push('┌─────────────────────────────────────────────────────────┐');
	lines.push('│ • If output is not 1024x1024 photographic quality:      │');
	lines.push('│   → Output is INVALID - regenerate at correct size      │');
	lines.push('│                                                         │');
	lines.push('│ • If ANY colored pixels detected in engraving:          │');
	lines.push('│   → Output is INCORRECT - regenerate completely         │');
	lines.push('│                                                         │');
	lines.push('│ • If product shape/material differs from imageproduct:  │');
	lines.push('│   → Output is WRONG - preserve product identity         │');
	lines.push('│                                                         │');
	lines.push('│ • If logo appears printed/painted instead of engraved:  │');
	lines.push('│   → Output is INVALID - apply proper metallic effect    │');
	lines.push('│                                                         │');
	lines.push('│ • If opener logo has colors or wrong orientation:       │');
	lines.push('│   → Output is WRONG - fix metallic tone and rotation    │');
	lines.push('└─────────────────────────────────────────────────────────┘');
	lines.push('');
	lines.push('⚠️ FINAL REMINDER:');
	lines.push(
		'Only metallic silver/gray/black tones are acceptable for laser engraving.',
	);
	lines.push(
		'Colors (red, blue, green, yellow, etc.) are PHYSICALLY IMPOSSIBLE in laser engraving.',
	);
	lines.push(
		'If output contains colors, it does NOT represent real laser engraving technology.',
	);
	lines.push('');

	// ── Watermark instructions (apenas quando solicitada) ───────────────────
	if (hasWatermark) {
		const watermarkIdx = isTextOnly ? '[2]' : '[3]';
		lines.push('🏷️ WATERMARK INSTRUCTIONS (MANDATORY):');
		lines.push('┌─────────────────────────────────────────────────────────┐');
		lines.push(
			`│ The ${watermarkIdx} watermark image is COMPANY BRANDING.            │`,
		);
		lines.push('│ Place it as a SEPARATE OVERLAY in TWO corners of the    │');
		lines.push('│ final output image (NOT engraved on the product):       │');
		lines.push('│                                                         │');
		lines.push('│   1. BOTTOM-LEFT corner                                 │');
		lines.push('│   2. TOP-RIGHT corner                                   │');
		lines.push('│                                                         │');
		lines.push('│ ✓ Size: ~8% of the output image width                   │');
		lines.push('│ ✓ Opacity: 100% (fully opaque, sharp)                   │');
		lines.push('│ ✓ Margin from edge: ~3% of image width                  │');
		lines.push('│ ✓ Same logo in both corners, SAME orientation           │');
		lines.push('│ ✓ Preserve the watermark colors exactly as provided     │');
		lines.push('│                                                         │');
		lines.push('│ ❌ DO NOT engrave the watermark on the product          │');
		lines.push('│ ❌ DO NOT modify, recolor, or stylize the watermark     │');
		lines.push('│ ❌ DO NOT place the watermark on the engraving area     │');
		lines.push('│ ❌ DO NOT convert the watermark to metallic — it is a   │');
		lines.push('│    flat branding overlay, NOT an engraving              │');
		lines.push('│                                                         │');
		lines.push('│ The watermark is a final-image overlay (like a digital  │');
		lines.push('│ stamp). The product and engraving stay UNTOUCHED.       │');
		lines.push('└─────────────────────────────────────────────────────────┘');
		lines.push('');
	}

	lines.push('🎬 GENERATE OUTPUT NOW WITH ALL REQUIREMENTS SATISFIED');

	return lines.join('\n');
}
