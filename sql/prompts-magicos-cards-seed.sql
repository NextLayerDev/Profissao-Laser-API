-- Prompts Mágicos — cards iniciais do banco (temas em alta nos personalizados,
-- pesquisa de 2026-11). Cada card diz em quais formatos faz sentido
-- (`data.formats`, ids de `definition.creations` separados por vírgula; vazio =
-- todos) e usa `{tema}` onde entra o pedido do aluno.
--
-- Entram como RASCUNHO (`active = false`): o admin testa cada um na tela de
-- Prompts Mágicos, sobe o exemplo de antes/depois e publica. Idempotente — um
-- card com o mesmo título não é duplicado.

insert into public.pl_tool_bank_entry
	(tool_key, title, description, category, position, active, data)
select 'prompts_magicos', v.title, v.description, v.category, v.position, false, v.data::jsonb
from (
	values
		(
			'Nome em flores aquarela',
			'O nome do cliente cercado de flores em aquarela.',
			'Nomes e frases',
			10,
			'{"mode": "texto", "formats": "capinha,caneca-325,quadro-a4,quadro-20x20", "prompt_script": "Ilustração em aquarela delicada com o nome \"{tema}\" em letra cursiva elegante no centro, cercado por flores do campo, folhagens e pequenos ramos em tons pastel (rosa antigo, lavanda, verde-sálvia). Fundo branco-creme com textura leve de papel. Composição equilibrada, sem outros textos."}'
		),
		(
			'Retrato do pet em aquarela',
			'Transforma a foto do pet num retrato pintado.',
			'Pets',
			20,
			'{"mode": "texto_imagem", "formats": "capinha,caneca-325,copo-360,quadro-a4,quadro-20x20,chaveiro-redondo", "prompt_script": "Retrato do animal da foto de referência em aquarela solta e expressiva, mantendo fielmente a raça, a cor da pelagem e as marcas do rosto. Respingos suaves de tinta ao redor e fundo claro. Se houver texto, escreva apenas \"{tema}\" em letra manuscrita simples abaixo do retrato."}'
		),
		(
			'Natal aconchegante',
			'Cena natalina acolhedora, para a temporada de fim de ano.',
			'Datas comemorativas',
			30,
			'{"mode": "texto", "formats": "caneca-325,copo-360,copo-180,quadro-a4,quadro-20x20", "prompt_script": "Ilustração natalina aconchegante no estilo livro infantil: pinheiro decorado, luzes quentes, flocos de neve, biscoitos de gengibre e uma caneca fumegante. Paleta vermelho, verde-musgo e dourado sobre fundo creme. Tema pedido pelo cliente: {tema}. Traço limpo e alegre."}'
		),
		(
			'Line art minimalista',
			'Traço contínuo em linha fina — fica ótimo gravado a laser.',
			'Minimalista',
			40,
			'{"mode": "texto", "formats": "capinha,copo-360,copo-180,chaveiro-redondo,chaveiro-retangular,vetor", "prompt_script": "Desenho em linha contínua (one line art) de {tema}, traço preto fino e uniforme sobre fundo branco puro, sem sombras, sem preenchimentos e sem textura. Estilo minimalista elegante, pronto para gravação a laser."}'
		),
		(
			'Signo e constelação',
			'O signo do cliente com a constelação e detalhes dourados.',
			'Astrologia',
			50,
			'{"mode": "texto", "formats": "capinha,caneca-325,chaveiro-redondo,quadro-20x20", "prompt_script": "Arte mística do signo de {tema}: símbolo do signo em dourado no centro, constelação correspondente com estrelas brilhantes ligadas por linhas finas, lua crescente e pequenas estrelas. Fundo azul-noite profundo com leve degradê. Estilo elegante e moderno."}'
		),
		(
			'Versículo com flores',
			'Frase de fé em tipografia bonita com moldura floral.',
			'Fé',
			60,
			'{"mode": "texto", "formats": "caneca-325,quadro-a4,quadro-20x20", "prompt_script": "Composição tipográfica com a frase \"{tema}\" em letras manuscritas e serifadas combinadas, centralizada, cercada por uma guirlanda de flores e folhas em aquarela suave. Fundo branco. Escreva o texto exatamente como foi pedido, sem erros de ortografia."}'
		),
		(
			'Casal em cartoon',
			'Transforma a foto do casal numa ilustração fofa.',
			'Pessoas',
			70,
			'{"mode": "texto_imagem", "formats": "capinha,caneca-325,quadro-a4,quadro-20x20", "prompt_script": "Ilustração em estilo cartoon fofo (cabeças levemente grandes, olhos expressivos) do casal da foto de referência, mantendo cabelo, tom de pele, roupas e acessórios. Fundo simples com corações pequenos. Se houver texto, use apenas \"{tema}\"."}'
		),
		(
			'Profissão com orgulho',
			'Arte divertida de profissão — campeã de vendas em canecas.',
			'Profissões',
			80,
			'{"mode": "texto", "formats": "caneca-325,copo-360,chaveiro-retangular", "prompt_script": "Ilustração alegre e colorida celebrando a profissão {tema}: os instrumentos e símbolos típicos dessa profissão arranjados ao redor de um título em letras grandes e divertidas com o nome da profissão. Estilo flat moderno, fundo branco."}'
		),
		(
			'Retrô anos 90',
			'Visual Y2K com cores vibrantes, cromado e brilhos.',
			'Tendências',
			90,
			'{"mode": "texto", "formats": "capinha,copo-360,copo-180", "prompt_script": "Arte no estilo Y2K anos 90/2000 sobre {tema}: letras cromadas brilhantes, estrelas de quatro pontas, borboletas, degradês em rosa, lilás e azul-bebê, efeito holográfico. Composição cheia e vibrante."}'
		)
) as v(title, description, category, position, data)
where not exists (
	select 1 from public.pl_tool_bank_entry e
	where e.tool_key = 'prompts_magicos' and e.title = v.title
);
