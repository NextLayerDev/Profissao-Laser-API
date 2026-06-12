// ─────────────────────────────────────────────────────────────────────────
// Catálogo de opções da Prévia IA — fonte única de verdade.
// Valores + labels portados de:
//   system_porteira/src/components/ia-previsoes.tsx
//     LASER_OPTIONS (linhas 256–363) e FONT_OPTIONS (linhas 151–240)
//
// Usado em 2 lugares:
//   1. src/types/previa.ts → z.enum() pra validar o body de /previas/generate
//   2. GET /previas/options → catálogo pro frontend montar os seletores
// ─────────────────────────────────────────────────────────────────────────

export interface OptionItem {
	value: string;
	label: string;
}

export interface FontOption {
	value: string;
	label: string;
	family: string;
	category: string;
}

// ─── Campos discretos do LaserSettings ────────────────────────────────────

export const LASER_OPTIONS = {
	tamanho: [
		{ value: 'pequeno', label: 'Pequeno (2x2cm)' },
		{ value: 'medio', label: 'Medio (5x5cm)' },
		{ value: 'grande', label: 'Grande (10x10cm)' },
		{ value: 'custom', label: 'Personalizado' },
	],
	posicao: [
		{ value: 'central', label: 'Central' },
		{ value: 'superior', label: 'Superior' },
		{ value: 'inferior', label: 'Inferior' },
		{ value: 'lateral', label: 'Lateral' },
		{ value: 'envolvente-360', label: 'Envolvente (360°)' },
	],
	intensidade: [
		{ value: 'baixa', label: 'Baixa (25%)' },
		{ value: 'media', label: 'Media (50%)' },
		{ value: 'alta', label: 'Alta (75%)' },
		{ value: 'maxima', label: 'Maxima (100%)' },
	],
	profundidade: [
		{ value: 'superficial', label: 'Superficial (0.1mm)' },
		{ value: 'media', label: 'Media (0.3mm)' },
		{ value: 'profunda', label: 'Profunda (0.5mm)' },
	],
	tamanhoNome: [
		{ value: 'pequeno', label: 'Pequeno' },
		{ value: 'medio', label: 'Medio' },
		{ value: 'grande', label: 'Grande' },
	],
	material: [
		{ value: 'aco-inox', label: 'Aco Inox' },
		{ value: 'inox-pintado', label: 'Inox Pintado (copo térmico)' },
		{ value: 'aluminio', label: 'Aluminio' },
		{ value: 'aluminio-anodizado', label: 'Alumínio Anodizado' },
		{ value: 'madeira', label: 'Madeira' },
		{ value: 'mdf', label: 'MDF' },
		{ value: 'bambu', label: 'Bambu' },
		{ value: 'couro', label: 'Couro' },
		{ value: 'acrilico', label: 'Acrilico' },
		{ value: 'vidro', label: 'Vidro' },
		{ value: 'cristal', label: 'Cristal' },
		{ value: 'ceramica', label: 'Ceramica' },
		{ value: 'porcelana', label: 'Porcelana' },
		{ value: 'ardosia', label: 'Ardosia' },
		{ value: 'pedra', label: 'Pedra' },
		{ value: 'plastico', label: 'Plastico' },
		{ value: 'tecido', label: 'Tecido' },
	],
	estiloGravacao: [
		{ value: 'clean', label: 'Clean / Minimal' },
		{ value: 'vintage', label: 'Vintage / Distressed' },
		{ value: 'elegante', label: 'Elegante / Ornamental' },
		{ value: 'industrial', label: 'Industrial' },
		{ value: 'futurista', label: 'Futurista' },
	],
	acabamentoSuperficie: [
		{ value: 'fosco', label: 'Fosco' },
		{ value: 'acetinado', label: 'Acetinado' },
		{ value: 'escovado', label: 'Escovado' },
		{ value: 'polido', label: 'Polido' },
		{ value: 'brilhante', label: 'Brilhante' },
		{ value: 'espelhado', label: 'Espelhado' },
		{ value: 'texturizado', label: 'Texturizado' },
	],
	moldura: [
		{ value: 'nenhuma', label: 'Sem moldura' },
		{ value: 'simples', label: 'Linha simples' },
		{ value: 'dupla', label: 'Linha dupla' },
		{ value: 'ornamental', label: 'Ornamental' },
		{ value: 'arredondada', label: 'Arredondada' },
	],
	posicaoTextoRelLogo: [
		{ value: 'abaixo', label: 'Abaixo do logo' },
		{ value: 'acima', label: 'Acima do logo' },
		{ value: 'lado-esquerdo', label: 'Esquerda' },
		{ value: 'lado-direito', label: 'Direita' },
		{ value: 'integrado', label: 'Integrado' },
	],
	espacamentoLogoTexto: [
		{ value: 'justo', label: 'Justo' },
		{ value: 'medio', label: 'Medio' },
		{ value: 'amplo', label: 'Amplo' },
	],
	tipoVisualizacao: [
		{ value: 'frontal-padrao', label: 'Frontal Padrão' },
		{ value: 'angulo-3d', label: 'Ângulo 3D' },
		{ value: '360', label: '360° Completo' },
		{ value: 'closeup-gravacao', label: 'Close-up da Gravação' },
		{ value: 'lifestyle', label: 'Lifestyle / Cena' },
		{ value: 'flat-lay', label: 'Flat Lay' },
		{ value: 'em-uso', label: 'Em Uso / Mão' },
		{ value: 'overhead', label: 'Vista Superior' },
		{ value: 'multi-angulo', label: 'Multi-ângulo' },
		{ value: 'turntable-4', label: 'Giro 360° (4 ângulos)' },
		{ value: 'render-3d', label: 'Render 3D' },
		{ value: 'fotogravacao', label: 'Fotogravação' },
	],
	anguloCamera: [
		{ value: 'frontal', label: 'Frontal (0°)' },
		{ value: '45-esquerda', label: '3/4 Esq. (45°)' },
		{ value: '45-direita', label: '3/4 Dir. (-45°)' },
		{ value: 'superior-45', label: 'Semi-sup. (70°)' },
		{ value: 'overhead', label: 'Topo (90°)' },
	],
	iluminacao: [
		{ value: 'studio-softbox', label: 'Estúdio Softbox' },
		{ value: 'luz-natural', label: 'Luz Natural' },
		{ value: 'rim-light', label: 'Rim Light' },
		{ value: 'dramatica', label: 'Dramática' },
		{ value: 'produto-heroi', label: 'Produto Herói' },
		{ value: 'ambiente', label: 'Luz Ambiente' },
	],
	fundoCena: [
		{ value: 'branco-puro', label: 'Branco Puro' },
		{ value: 'cinza-gradiente', label: 'Cinza Gradiente' },
		{ value: 'preto-fosco', label: 'Preto Fosco' },
		{ value: 'madeira', label: 'Madeira / Mesa' },
		{ value: 'mesa-ambiente', label: 'Mesa + Ambiente' },
		{ value: 'marmore', label: 'Mármore' },
		{ value: 'tecido-linho', label: 'Tecido / Linho' },
		{ value: 'ambiente-decorado', label: 'Ambiente Decorado' },
		{ value: 'transparente', label: 'Transparente (PNG)' },
	],
	// Toggles que no porteira eram switches — aqui viram enums de 2 valores
	orientacaoLogo: [
		{ value: 'horizontal', label: 'Horizontal' },
		{ value: 'vertical', label: 'Vertical' },
	],
	orientacaoNome: [
		{ value: 'horizontal', label: 'Horizontal' },
		{ value: 'vertical', label: 'Vertical' },
	],
	comNome: [
		{ value: 'sem', label: 'Sem nome' },
		{ value: 'com', label: 'Com nome' },
	],
} satisfies Record<string, OptionItem[]>;

// ─── Fontes (80 opções, 7 categorias) ─────────────────────────────────────

export const FONT_OPTIONS: FontOption[] = [
	// Sans-serif
	{
		value: 'arial',
		label: 'Arial',
		family: 'Arial, sans-serif',
		category: 'Sans-Serif',
	},
	{
		value: 'helvetica',
		label: 'Helvetica',
		family: 'Helvetica, sans-serif',
		category: 'Sans-Serif',
	},
	{
		value: 'roboto',
		label: 'Roboto',
		family: "'Roboto', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'open-sans',
		label: 'Open Sans',
		family: "'Open Sans', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'montserrat',
		label: 'Montserrat',
		family: "'Montserrat', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'lato',
		label: 'Lato',
		family: "'Lato', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'poppins',
		label: 'Poppins',
		family: "'Poppins', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'raleway',
		label: 'Raleway',
		family: "'Raleway', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'nunito',
		label: 'Nunito',
		family: "'Nunito', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'ubuntu',
		label: 'Ubuntu',
		family: "'Ubuntu', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'work-sans',
		label: 'Work Sans',
		family: "'Work Sans', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'inter',
		label: 'Inter',
		family: "'Inter', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'segoe-ui',
		label: 'Segoe UI',
		family: "'Segoe UI', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'verdana',
		label: 'Verdana',
		family: 'Verdana, sans-serif',
		category: 'Sans-Serif',
	},
	{
		value: 'tahoma',
		label: 'Tahoma',
		family: 'Tahoma, sans-serif',
		category: 'Sans-Serif',
	},
	{
		value: 'barlow',
		label: 'Barlow',
		family: "'Barlow', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'dm-sans',
		label: 'DM Sans',
		family: "'DM Sans', sans-serif",
		category: 'Sans-Serif',
	},
	{
		value: 'source-sans-pro',
		label: 'Source Sans Pro',
		family: "'Source Sans Pro', sans-serif",
		category: 'Sans-Serif',
	},
	// Serif
	{
		value: 'times',
		label: 'Times New Roman',
		family: "'Times New Roman', serif",
		category: 'Serif',
	},
	{
		value: 'georgia',
		label: 'Georgia',
		family: 'Georgia, serif',
		category: 'Serif',
	},
	{
		value: 'palatino',
		label: 'Palatino',
		family: 'Palatino, serif',
		category: 'Serif',
	},
	{
		value: 'garamond',
		label: 'Garamond',
		family: 'Garamond, serif',
		category: 'Serif',
	},
	{
		value: 'baskerville',
		label: 'Baskerville',
		family: 'Baskerville, serif',
		category: 'Serif',
	},
	{
		value: 'book-antiqua',
		label: 'Book Antiqua',
		family: "'Book Antiqua', serif",
		category: 'Serif',
	},
	{
		value: 'merriweather',
		label: 'Merriweather',
		family: "'Merriweather', serif",
		category: 'Serif',
	},
	{
		value: 'playfair-display',
		label: 'Playfair Display',
		family: "'Playfair Display', serif",
		category: 'Serif',
	},
	{ value: 'lora', label: 'Lora', family: "'Lora', serif", category: 'Serif' },
	{
		value: 'crimson-text',
		label: 'Crimson Text',
		family: "'Crimson Text', serif",
		category: 'Serif',
	},
	{
		value: 'libre-baskerville',
		label: 'Libre Baskerville',
		family: "'Libre Baskerville', serif",
		category: 'Serif',
	},
	{
		value: 'eb-garamond',
		label: 'EB Garamond',
		family: "'EB Garamond', serif",
		category: 'Serif',
	},
	{
		value: 'spectral',
		label: 'Spectral',
		family: "'Spectral', serif",
		category: 'Serif',
	},
	{
		value: 'noto-serif',
		label: 'Noto Serif',
		family: "'Noto Serif', serif",
		category: 'Serif',
	},
	// Script
	{
		value: 'brush-script',
		label: 'Brush Script',
		family: "'Brush Script MT', cursive",
		category: 'Script',
	},
	{
		value: 'dancing-script',
		label: 'Dancing Script',
		family: "'Dancing Script', cursive",
		category: 'Script',
	},
	{
		value: 'pacifico',
		label: 'Pacifico',
		family: "'Pacifico', cursive",
		category: 'Script',
	},
	{
		value: 'lobster',
		label: 'Lobster',
		family: "'Lobster', cursive",
		category: 'Script',
	},
	{
		value: 'great-vibes',
		label: 'Great Vibes',
		family: "'Great Vibes', cursive",
		category: 'Script',
	},
	{
		value: 'satisfy',
		label: 'Satisfy',
		family: "'Satisfy', cursive",
		category: 'Script',
	},
	{
		value: 'kalam',
		label: 'Kalam',
		family: "'Kalam', cursive",
		category: 'Script',
	},
	{
		value: 'indie-flower',
		label: 'Indie Flower',
		family: "'Indie Flower', cursive",
		category: 'Script',
	},
	{
		value: 'caveat',
		label: 'Caveat',
		family: "'Caveat', cursive",
		category: 'Script',
	},
	{
		value: 'amatic-sc',
		label: 'Amatic SC',
		family: "'Amatic SC', cursive",
		category: 'Script',
	},
	{
		value: 'allura',
		label: 'Allura',
		family: "'Allura', cursive",
		category: 'Script',
	},
	{
		value: 'sacramento',
		label: 'Sacramento',
		family: "'Sacramento', cursive",
		category: 'Script',
	},
	{
		value: 'parisienne',
		label: 'Parisienne',
		family: "'Parisienne', cursive",
		category: 'Script',
	},
	{
		value: 'alex-brush',
		label: 'Alex Brush',
		family: "'Alex Brush', cursive",
		category: 'Script',
	},
	{
		value: 'cookie',
		label: 'Cookie',
		family: "'Cookie', cursive",
		category: 'Script',
	},
	{
		value: 'tangerine',
		label: 'Tangerine',
		family: "'Tangerine', cursive",
		category: 'Script',
	},
	{
		value: 'courgette',
		label: 'Courgette',
		family: "'Courgette', cursive",
		category: 'Script',
	},
	// Display
	{
		value: 'impact',
		label: 'Impact',
		family: 'Impact, sans-serif',
		category: 'Display',
	},
	{
		value: 'arial-black',
		label: 'Arial Black',
		family: "'Arial Black', sans-serif",
		category: 'Display',
	},
	{
		value: 'oswald',
		label: 'Oswald',
		family: "'Oswald', sans-serif",
		category: 'Display',
	},
	{
		value: 'bebas-neue',
		label: 'Bebas Neue',
		family: "'Bebas Neue', sans-serif",
		category: 'Display',
	},
	{
		value: 'russo-one',
		label: 'Russo One',
		family: "'Russo One', sans-serif",
		category: 'Display',
	},
	{
		value: 'anton',
		label: 'Anton',
		family: "'Anton', sans-serif",
		category: 'Display',
	},
	{
		value: 'righteous',
		label: 'Righteous',
		family: "'Righteous', sans-serif",
		category: 'Display',
	},
	{
		value: 'orbitron',
		label: 'Orbitron',
		family: "'Orbitron', sans-serif",
		category: 'Display',
	},
	{
		value: 'rajdhani',
		label: 'Rajdhani',
		family: "'Rajdhani', sans-serif",
		category: 'Display',
	},
	{
		value: 'bangers',
		label: 'Bangers',
		family: "'Bangers', cursive",
		category: 'Display',
	},
	{
		value: 'fredoka',
		label: 'Fredoka',
		family: "'Fredoka', sans-serif",
		category: 'Display',
	},
	{
		value: 'black-ops-one',
		label: 'Black Ops One',
		family: "'Black Ops One', cursive",
		category: 'Display',
	},
	{
		value: 'press-start-2p',
		label: 'Press Start 2P',
		family: "'Press Start 2P', cursive",
		category: 'Display',
	},
	// Manuscrita
	{
		value: 'comic-sans',
		label: 'Comic Sans',
		family: "'Comic Sans MS', cursive",
		category: 'Manuscrita',
	},
	{
		value: 'handlee',
		label: 'Handlee',
		family: "'Handlee', cursive",
		category: 'Manuscrita',
	},
	{
		value: 'permanent-marker',
		label: 'Permanent Marker',
		family: "'Permanent Marker', cursive",
		category: 'Manuscrita',
	},
	{
		value: 'rock-salt',
		label: 'Rock Salt',
		family: "'Rock Salt', cursive",
		category: 'Manuscrita',
	},
	{
		value: 'patrick-hand',
		label: 'Patrick Hand',
		family: "'Patrick Hand', cursive",
		category: 'Manuscrita',
	},
	{
		value: 'gloria-hallelujah',
		label: 'Gloria Hallelujah',
		family: "'Gloria Hallelujah', cursive",
		category: 'Manuscrita',
	},
	// Elegante
	{
		value: 'cormorant',
		label: 'Cormorant',
		family: "'Cormorant', serif",
		category: 'Elegante',
	},
	{
		value: 'cinzel',
		label: 'Cinzel',
		family: "'Cinzel', serif",
		category: 'Elegante',
	},
	{
		value: 'prata',
		label: 'Prata',
		family: "'Prata', serif",
		category: 'Elegante',
	},
	{
		value: 'lusitana',
		label: 'Lusitana',
		family: "'Lusitana', serif",
		category: 'Elegante',
	},
	{
		value: 'bodoni-moda',
		label: 'Bodoni Moda',
		family: "'Bodoni Moda', serif",
		category: 'Elegante',
	},
	{
		value: 'tenor-sans',
		label: 'Tenor Sans',
		family: "'Tenor Sans', sans-serif",
		category: 'Elegante',
	},
	// Monospace
	{
		value: 'courier',
		label: 'Courier New',
		family: "'Courier New', monospace",
		category: 'Monospace',
	},
	{
		value: 'monaco',
		label: 'Monaco',
		family: 'Monaco, monospace',
		category: 'Monospace',
	},
	{
		value: 'fira-code',
		label: 'Fira Code',
		family: "'Fira Code', monospace",
		category: 'Monospace',
	},
	{
		value: 'jetbrains-mono',
		label: 'JetBrains Mono',
		family: "'JetBrains Mono', monospace",
		category: 'Monospace',
	},
	{
		value: 'space-mono',
		label: 'Space Mono',
		family: "'Space Mono', monospace",
		category: 'Monospace',
	},
	// Designer
	{
		value: 'designer',
		label: 'Designer',
		family: "'Designer', cursive",
		category: 'Display',
	},
];

// Ranges dos sliders numéricos do LaserSettings
export const LASER_RANGES = {
	rotacao: { min: 0, max: 360 },
	contraste: { min: 0, max: 100 },
	efeitoSombra: { min: 0, max: 100 },
} as const;

// ─── Helper: extrai os values de uma lista de OptionItem para z.enum() ────
export function optionValues(opts: OptionItem[]): [string, ...string[]] {
	return opts.map((o) => o.value) as [string, ...string[]];
}

export const FONT_VALUES: [string, ...string[]] = FONT_OPTIONS.map(
	(f) => f.value,
) as [string, ...string[]];
