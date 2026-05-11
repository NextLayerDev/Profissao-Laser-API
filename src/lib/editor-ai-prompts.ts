// ─────────────────────────────────────────────────────────────────
// Cópia verbatim dos prompts do editor-ai de:
//   system_porteira/src/app/api/editor-ai/route.ts (linhas 38–229)
// Mantido idêntico para garantir comportamento exato.
// Adicionado: createRemoveBackgroundPrompt (substitui U2-Net/remove.bg)
// ─────────────────────────────────────────────────────────────────

// Prompt otimizado para remoção de fundo via modelo de imagem (Gemini)
export function createRemoveBackgroundPrompt(): string {
	return `You are a professional image editor performing precise BACKGROUND REMOVAL.

═══════════════════════════════════════════════════════════════
TASK: Remove the background from the provided image.
═══════════════════════════════════════════════════════════════

OUTPUT REQUIREMENTS:
✓ Return a PNG image with TRANSPARENT BACKGROUND (alpha channel)
✓ Keep the main subject (product, logo, person, object) exactly as it is
✓ Same dimensions, same resolution as the input image
✓ Preserve original colors, lighting, shadows, and edges of the subject
✓ Soft edges (hair, fur, glass, semi-transparent areas) must retain partial alpha
✓ Hard edges (product surfaces, logos) must have clean alpha cut-out

CRITICAL RULES:
✗ DO NOT replace background with white, black, gray, or any solid color
✗ DO NOT add any new elements, watermarks, or decorations
✗ DO NOT modify, recolor, or resize the subject
✗ DO NOT crop the image — keep original framing and dimensions
✗ DO NOT add checkered "transparency" pattern — output must be truly transparent

The output MUST be a PNG file with a real alpha channel where all background pixels have alpha = 0 (fully transparent) and subject pixels keep their full opacity.

EXECUTE NOW: Remove the background, return the same image with only the subject visible on a fully transparent canvas.`;
}

// Prompt de edição otimizado para gravação a laser
export function createEditPrompt(userRequest: string): string {
	return `You are a professional image editor specialized in LASER ENGRAVING preview images for promotional products.

═══════════════════════════════════════════════════════════════
EDIT REQUEST: ${userRequest}
═══════════════════════════════════════════════════════════════

CONTEXT: This is a laser engraving preview image. The image shows a product (tumbler, bottle, cutting board, pen, etc.) with an engraved logo, text, or design.

CRITICAL UNDERSTANDING:
• The engraving appears as a METALLIC effect (silver/gray tones on dark surfaces, dark tones on light surfaces)
• Laser engraving is MONOCHROME - only metallic silver, gray, or black tones
• The engraving has a subtle depth/relief appearance
• Text and logos appear as if physically etched into the material

═══════════════════════════════════════════════════════════════
COMMON EDIT TYPES AND HOW TO HANDLE THEM:
═══════════════════════════════════════════════════════════════

1. MOVE/REPOSITION REQUESTS
   Examples: "move logo up", "move text down", "center the logo", "move to the left"
   
   HOW TO EXECUTE:
   → Identify the engraved element (logo, text, design) to be moved
   → Relocate it to the specified position on the product surface
   → KEEP the same size, metallic color, and engraving style
   → KEEP the same font and text content (if text)
   → Maintain proper alignment and spacing
   → Ensure the element stays on the engravable surface area
   → DO NOT change any other elements in the image

2. FONT/TEXT STYLE CHANGES
   Examples: "change font to bold", "use a different font", "make text italic"
   
   HOW TO EXECUTE:
   → Identify the engraved text to modify
   → Change ONLY the font style as requested
   → KEEP the same text content (exact same words)
   → KEEP the same position on the product
   → KEEP the same metallic engraving color (silver/gray)
   → KEEP the same size unless specified otherwise
   → Maintain the laser-engraved metallic appearance
   → Common font styles: Arial, Helvetica, Times, Script, Bold, Italic

3. SIZE CHANGES
   Examples: "make logo bigger", "reduce text size", "increase by 20%"
   
   HOW TO EXECUTE:
   → Identify the element to resize
   → Scale proportionally as requested
   → KEEP the same position (centered on current location)
   → KEEP the metallic engraving appearance
   → Ensure it fits within the product surface

4. TEXT CONTENT CHANGES
   Examples: "change name to João", "update text to ABC Company"
   
   HOW TO EXECUTE:
   → Replace the text with the new content
   → KEEP the same font style and size
   → KEEP the same position
   → KEEP the metallic engraving color
   → Maintain professional legibility

5. ROTATION REQUESTS
   Examples: "rotate logo 90 degrees", "tilt text slightly"
   
   HOW TO EXECUTE:
   → Rotate the specified element by the requested angle
   → KEEP all other properties unchanged
   → Maintain the metallic appearance

═══════════════════════════════════════════════════════════════
MANDATORY RULES:
═══════════════════════════════════════════════════════════════

✓ PRESERVE the product image exactly (bottle, tumbler, etc.)
✓ PRESERVE the background and composition
✓ PRESERVE elements NOT mentioned in the request
✓ MAINTAIN the laser engraving metallic effect (no colors!)
✓ KEEP high image quality and resolution
✓ Make the edit look natural and professional

✗ DO NOT add colors to the engraving (must stay metallic)
✗ DO NOT change elements not mentioned in the request
✗ DO NOT alter the product itself
✗ DO NOT add watermarks or extra elements

═══════════════════════════════════════════════════════════════
OUTPUT:
═══════════════════════════════════════════════════════════════

Generate ONE edited image (1024x1024) with ONLY the requested change applied.
The edit must look professional and maintain the realistic laser engraving appearance.

EXECUTE NOW: ${userRequest}`;
}

// Prompt otimizado para inpainting de região específica
export function createInpaintingPrompt(
	userRequest: string,
	regionInfo?: { x: number; y: number; width: number; height: number },
): string {
	const regionDesc = regionInfo
		? `SELECTED REGION: Rectangle starting at position (${regionInfo.x}, ${regionInfo.y}) with width ${regionInfo.width}px and height ${regionInfo.height}px.`
		: 'SELECTED REGION: The user has selected a specific area of the image.';

	return `You are a professional image editor performing INPAINTING on a specific region of an image.

═══════════════════════════════════════════════════════════════
INPAINTING TASK
═══════════════════════════════════════════════════════════════

${regionDesc}

═══════════════════════════════════════════════════════════════
CRITICAL RULES FOR INPAINTING:
═══════════════════════════════════════════════════════════════

1. ONLY modify the specified rectangular region
2. Keep ALL pixels OUTSIDE the selected region EXACTLY the same
3. The edited region must blend seamlessly with surrounding areas
4. Match the lighting, color temperature, and style of the original
5. Maintain consistent perspective and proportions
6. Preserve any recurring patterns or textures

═══════════════════════════════════════════════════════════════
EDIT REQUEST FOR THE SELECTED REGION:
═══════════════════════════════════════════════════════════════

${userRequest}

═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS:
═══════════════════════════════════════════════════════════════

- Generate ONE image (1024x1024)
- The edit must look natural and professional
- Edges should blend smoothly with no visible seams
- Quality must match or exceed the original

EXECUTE THE INPAINTING NOW.`;
}

// Prompt de geração para criar imagens de produtos com gravação
export function createGeneratePrompt(userRequest: string): string {
	return `You are a professional graphic designer specialized in creating product mockups for LASER ENGRAVING companies.

═══════════════════════════════════════════════════════════════
CREATE: ${userRequest}
═══════════════════════════════════════════════════════════════

CONTEXT: You are creating preview images for a laser engraving business. The images should show products with realistic laser-engraved designs.

LASER ENGRAVING CHARACTERISTICS:
• Engraving is ALWAYS monochrome metallic (silver/gray/black tones)
• Creates a subtle depth/relief effect on the material
• High contrast between engraved area and product surface
• Professional, clean, sharp edges
• NO colors in the engraving - only metallic tones

DESIGN GUIDELINES:

1. PRODUCT TYPES (if applicable):
   • Tumblers, bottles, thermoses
   • Cutting boards, serving boards
   • Pens, keychains
   • Knives, tools
   • Promotional items

2. ENGRAVING STYLE:
   • Metallic silver on dark surfaces
   • Dark metallic gray on light surfaces
   • Sharp, vector-quality edges
   • Professional industrial appearance
   • Realistic depth perception

3. COMPOSITION:
   • Clean, professional product photography style
   • Neutral or complementary background
   • Good lighting that highlights the engraving
   • High quality and resolution

4. TECHNICAL SPECS:
   • Resolution: 1024x1024 pixels
   • High quality output
   • No watermarks
   • Ready for client presentation

GENERATE: ${userRequest}`;
}
