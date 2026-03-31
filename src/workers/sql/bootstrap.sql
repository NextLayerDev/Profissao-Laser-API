-- ============================================================
-- SCRIPT COMPLETO DO BANCO DE DADOS - system_porteira
-- IDEMPOTENTE: pode ser re-executado sem erro
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Company
CREATE TABLE IF NOT EXISTS "Company" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'PRATA',
    "payment_status" TEXT,
    "start_plan" TIMESTAMP(3),
    "end_plan" TIMESTAMP(3),
    "method_payment" TEXT,
    "password_action" TEXT,
    "password_action_ativa" BOOLEAN DEFAULT false,
    "profissao_laser" BOOLEAN DEFAULT false,
    "only_profissao" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

-- loginUser
CREATE TABLE IF NOT EXISTS "loginUser" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "cargo" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL,
    "dataCriacao" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

-- Banco_Previas
CREATE TABLE IF NOT EXISTS "Banco_Previas" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nome_produto" TEXT NOT NULL,
    "imagem" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipo_imagem" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

-- User_System
CREATE TABLE IF NOT EXISTS "User_System" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "email" TEXT NOT NULL UNIQUE,
    "nome" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL,
    "data_criacao" TIMESTAMP(3),
    "data_edicao" TIMESTAMP(3),
    "permissoes" JSONB NOT NULL,
    "janelaAcessoInicio" TEXT,
    "janelaAcessoFim" TEXT,
    "bloqueadoAte" TIMESTAMP(3),
    "forcarLogout" BOOLEAN DEFAULT false,
    "email_pessoal" TEXT,
    "email_notificacoes" BOOLEAN DEFAULT false,
    "email_notificacoes_pagamentos" BOOLEAN DEFAULT false,
    "preferencias_sidebar" JSONB,
    "companyId" UUID,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_user_system_companyId" ON "User_System"("companyId");

-- Produto
CREATE TABLE IF NOT EXISTS "Produto" (
    "id_produt" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "preco" DOUBLE PRECISION,
    "fornecedor" TEXT,
    "data_entrada" TIMESTAMP(3),
    "image" TEXT,
    PRIMARY KEY ("id_produt")
);

-- ProdutoVariante
CREATE TABLE IF NOT EXISTS "ProdutoVariante" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "cor" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "image" TEXT,
    "sku" TEXT,
    "productId" UUID NOT NULL,
    "custo_materia" DOUBLE PRECISION,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("productId") REFERENCES "Produto"("id_produt")
);

-- PrecoPorQuantidade
CREATE TABLE IF NOT EXISTS "PrecoPorQuantidade" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "produtoId" UUID NOT NULL,
    "quantidadeMin" INTEGER NOT NULL,
    "quantidadeMax" INTEGER,
    "preco" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("produtoId") REFERENCES "Produto"("id_produt") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_precoqtd_produtoId" ON "PrecoPorQuantidade"("produtoId");
CREATE INDEX IF NOT EXISTS "idx_precoqtd_quantidadeMin" ON "PrecoPorQuantidade"("quantidadeMin");

-- Pedido
CREATE TABLE IF NOT EXISTS "Pedido" (
    "pedido_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "identificador" TEXT UNIQUE,
    "data_pedido" TIMESTAMP(3) NOT NULL,
    "data_conclusao" TIMESTAMP(3),
    "data_edicao" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "total_custo" DECIMAL(65,30),
    "logo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logo_raw" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "item" JSONB NOT NULL,
    "cliente_infos" JSONB NOT NULL,
    "statusPagamento" TEXT,
    "etiqueta" TEXT,
    "descricao" TEXT,
    "nomesLista" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "arquivos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ParametroVenda" TEXT,
    "impressao_etiqueta" BOOLEAN,
    "criadoPor" TEXT,
    "vendidoPor" TEXT,
    "metricas" JSONB,
    "total_bruto" DECIMAL(65,30),
    "realizado_por" TEXT,
    "tipo_maquina" TEXT,
    "custo_dtf_UV" DECIMAL(65,30),
    "editado_por" TEXT,
    "editado_acao" TEXT,
    "pedido_futuro" BOOLEAN DEFAULT false,
    "pedido_anotacao" BOOLEAN DEFAULT false,
    "resumo_atendimento" TEXT,
    "status_atendimento" TEXT,
    "link_conversa" TEXT,
    "data_entrega" TIMESTAMP(3),
    "externalReference" TEXT UNIQUE,
    "codigo_barras" TEXT,
    "bipado" BOOLEAN DEFAULT false,
    "data_bipagem" TIMESTAMP(3),
    "bipado_por" TEXT,
    PRIMARY KEY ("pedido_id")
);
CREATE INDEX IF NOT EXISTS "idx_pedido_bipado" ON "Pedido"("bipado");
CREATE INDEX IF NOT EXISTS "idx_pedido_codigo_barras" ON "Pedido"("codigo_barras");

-- CheckoutPendente
CREATE TABLE IF NOT EXISTS "CheckoutPendente" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "item" JSONB NOT NULL,
    "cliente_infos" JSONB NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "total_custo" DECIMAL(65,30),
    "metricas" JSONB,
    "stripe_session_id" TEXT UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "data_criacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_abandonado" TIMESTAMP(3),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_checkout_status" ON "CheckoutPendente"("status");
CREATE INDEX IF NOT EXISTS "idx_checkout_stripe_session" ON "CheckoutPendente"("stripe_session_id");
CREATE INDEX IF NOT EXISTS "idx_checkout_data_criacao" ON "CheckoutPendente"("data_criacao" DESC);

-- Perdas
CREATE TABLE IF NOT EXISTS "Perdas" (
    "perda_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "image" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "responsavel" TEXT NOT NULL,
    "dataPerda" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorTotal" DECIMAL(65,30) NOT NULL,
    PRIMARY KEY ("perda_id")
);

-- Custos
CREATE TABLE IF NOT EXISTS "Custos" (
    "custo_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "categoria" TEXT NOT NULL,
    "subcategoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(65,30) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "observacoes" TEXT NOT NULL,
    "recorrente" BOOLEAN NOT NULL,
    "centroCusto" TEXT NOT NULL,
    PRIMARY KEY ("custo_id")
);

-- Banco
CREATE TABLE IF NOT EXISTS "Banco" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nome" TEXT NOT NULL,
    "agencia" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "saldoInicial" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

-- PagamentoAgendado
CREATE TABLE IF NOT EXISTS "PagamentoAgendado" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "descricao" TEXT NOT NULL,
    "favorecido" TEXT NOT NULL,
    "valor" DECIMAL(65,30) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'agendado',
    "metodo" TEXT,
    "bancoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("bancoId") REFERENCES "Banco"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_pagagendado_bancoId" ON "PagamentoAgendado"("bancoId");

-- Transacoes
CREATE TABLE IF NOT EXISTS "Transacoes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tipo" INTEGER NOT NULL,
    "categoria" INTEGER NOT NULL,
    "descricao" TEXT,
    "metodo" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "valor" DECIMAL(65,30) NOT NULL,
    "criado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bancoId" UUID,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("bancoId") REFERENCES "Banco"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_transacoes_bancoId" ON "Transacoes"("bancoId");

-- PagamentoFornecedor
CREATE TABLE IF NOT EXISTS "PagamentoFornecedor" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "fornecedor" TEXT NOT NULL,
    "descricao" TEXT,
    "valor" DECIMAL(65,30) NOT NULL,
    "dataPagamento" TIMESTAMP(3) NOT NULL,
    "metodo" TEXT NOT NULL,
    "bancoId" UUID,
    "comprovante" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("bancoId") REFERENCES "Banco"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_pagfornecedor_bancoId" ON "PagamentoFornecedor"("bancoId");

-- ChatMensagem
CREATE TABLE IF NOT EXISTS "ChatMensagem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "remetenteId" TEXT NOT NULL,
    "destinatarioId" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "arquivo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_chatmsg_remetenteId" ON "ChatMensagem"("remetenteId");
CREATE INDEX IF NOT EXISTS "idx_chatmsg_destinatarioId" ON "ChatMensagem"("destinatarioId");
CREATE INDEX IF NOT EXISTS "idx_chatmsg_createdAt" ON "ChatMensagem"("createdAt");

-- ChatStatus
CREATE TABLE IF NOT EXISTS "ChatStatus" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "userId" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "ultimoAcesso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

-- ============== OMNI WHATSAPP ==============

-- OmniInstance
CREATE TABLE IF NOT EXISTS "OmniInstance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "instanceName" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "qrCode" TEXT,
    "phoneNumber" TEXT,
    "profileName" TEXT,
    "webhookUrl" TEXT,
    "apiKey" TEXT,
    "zapiInstanceId" TEXT,
    "zapiInstanceToken" TEXT,
    "companyId" UUID,
    "n8nFolderId" TEXT,
    "n8nWorkflowIds" JSONB,
    "setupStatus" TEXT NOT NULL DEFAULT 'pending',
    "setupError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL
);

-- OmniContact
CREATE TABLE IF NOT EXISTS "OmniContact" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "pushName" TEXT,
    "profilePicUrl" TEXT,
    "instanceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("instanceId") REFERENCES "OmniInstance"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_omnicontact_instanceId" ON "OmniContact"("instanceId");

-- OmniChat
CREATE TABLE IF NOT EXISTS "OmniChat" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lastMessage" TEXT,
    "lastMessageTime" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "assignedTo" TEXT,
    "userId" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lead_step" TEXT,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("contactId") REFERENCES "OmniContact"("id")
);
CREATE INDEX IF NOT EXISTS "idx_omnichat_contactId" ON "OmniChat"("contactId");
CREATE INDEX IF NOT EXISTS "idx_omnichat_userId" ON "OmniChat"("userId");
CREATE INDEX IF NOT EXISTS "idx_omnichat_lastMessageTime" ON "OmniChat"("lastMessageTime");

-- OmniMessage
CREATE TABLE IF NOT EXISTS "OmniMessage" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "chatId" TEXT NOT NULL,
    "messageId" TEXT UNIQUE,
    "sender" TEXT NOT NULL,
    "senderJid" TEXT NOT NULL,
    "content" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "fileName" TEXT,
    "caption" TEXT,
    "quotedMsg" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isFromMe" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("chatId") REFERENCES "OmniChat"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_omnimsg_chatId" ON "OmniMessage"("chatId");
CREATE INDEX IF NOT EXISTS "idx_omnimsg_messageId" ON "OmniMessage"("messageId");
CREATE INDEX IF NOT EXISTS "idx_omnimsg_timestamp" ON "OmniMessage"("timestamp");

-- ============== CONFIGURACAO LOJA ==============

CREATE TABLE IF NOT EXISTS "ConfiguracaoLoja" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nomeExibicao" TEXT NOT NULL DEFAULT 'Minha Loja',
    "slogan" TEXT,
    "descricao" TEXT,
    "logoUrl" TEXT,
    "logoUrlWhite" TEXT,
    "faviconUrl" TEXT,
    "corPrimaria" TEXT NOT NULL DEFAULT '#000000',
    "corSecundaria" TEXT NOT NULL DEFAULT '#3b82f6',
    "corAcento" TEXT NOT NULL DEFAULT '#22c55e',
    "corTexto" TEXT NOT NULL DEFAULT '#1f2937',
    "corTextoClaro" TEXT NOT NULL DEFAULT '#6b7280',
    "corFundo" TEXT NOT NULL DEFAULT '#ffffff',
    "corFundoSecundario" TEXT NOT NULL DEFAULT '#f9fafb',
    "corHeader" TEXT NOT NULL DEFAULT '#000000',
    "corHeaderTexto" TEXT NOT NULL DEFAULT '#ffffff',
    "corFooter" TEXT NOT NULL DEFAULT '#ffffff',
    "corFooterTexto" TEXT NOT NULL DEFAULT '#6b7280',
    "topBarTexto" TEXT DEFAULT '3x sem juros a partir de R$199,90',
    "topBarAtiva" BOOLEAN NOT NULL DEFAULT true,
    "topBarCorFundo" TEXT NOT NULL DEFAULT '#000000',
    "topBarCorTexto" TEXT NOT NULL DEFAULT '#ffffff',
    "banners" JSONB NOT NULL DEFAULT '[]',
    "mostrarBestSellers" BOOLEAN NOT NULL DEFAULT true,
    "mostrarCategorias" BOOLEAN NOT NULL DEFAULT true,
    "mostrarTestimonials" BOOLEAN NOT NULL DEFAULT true,
    "mostrarInstagram" BOOLEAN NOT NULL DEFAULT true,
    "mostrarNewsletter" BOOLEAN NOT NULL DEFAULT false,
    "instagramUrl" TEXT,
    "instagramHandle" TEXT,
    "facebookUrl" TEXT,
    "youtubeUrl" TEXT,
    "twitterUrl" TEXT,
    "tiktokUrl" TEXT,
    "whatsappNumero" TEXT,
    "linkedinUrl" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "horarioAtendimento" TEXT,
    "sobreNos" TEXT,
    "politicaPrivacidade" TEXT,
    "termosUso" TEXT,
    "politicaTrocas" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "metaKeywords" TEXT,
    "mostrarPrecoOriginal" BOOLEAN NOT NULL DEFAULT true,
    "mostrarDesconto" BOOLEAN NOT NULL DEFAULT true,
    "mostrarParcelamento" BOOLEAN NOT NULL DEFAULT true,
    "quantidadeParcelasSemJuros" INTEGER NOT NULL DEFAULT 10,
    "faixaPromoAtiva" BOOLEAN NOT NULL DEFAULT true,
    "faixaPromoTexto" TEXT DEFAULT 'CUPONS EXTRA',
    "faixaPromoCorFundo" TEXT NOT NULL DEFAULT '#3b82f6',
    "faixaPromoCorTexto" TEXT NOT NULL DEFAULT '#ffffff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

-- ============== ESTOQUE POR LOJA ==============

CREATE TABLE IF NOT EXISTS "Loja" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "nome" TEXT NOT NULL,
    "codigo" TEXT NOT NULL UNIQUE,
    "endereco" TEXT,
    "responsavel" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "nivelAlertaBaixo" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_loja_codigo" ON "Loja"("codigo");
CREATE INDEX IF NOT EXISTS "idx_loja_ativo" ON "Loja"("ativo");

CREATE TABLE IF NOT EXISTS "EstoqueLoja" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "lojaId" UUID NOT NULL,
    "produtoId" UUID NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "produtoCodigo" TEXT,
    "categoria" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "quantidadeMin" INTEGER NOT NULL DEFAULT 0,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id"),
    UNIQUE ("lojaId", "produtoId"),
    FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE,
    FOREIGN KEY ("produtoId") REFERENCES "Produto"("id_produt") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_estoqueloja_lojaId" ON "EstoqueLoja"("lojaId");
CREATE INDEX IF NOT EXISTS "idx_estoqueloja_produtoId" ON "EstoqueLoja"("produtoId");
CREATE INDEX IF NOT EXISTS "idx_estoqueloja_produtoNome" ON "EstoqueLoja"("produtoNome");
CREATE INDEX IF NOT EXISTS "idx_estoqueloja_quantidade" ON "EstoqueLoja"("quantidade");

CREATE TABLE IF NOT EXISTS "ArquivoEstoqueLoja" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "lojaId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "descricao" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_arqestoque_lojaId" ON "ArquivoEstoqueLoja"("lojaId");
CREATE INDEX IF NOT EXISTS "idx_arqestoque_createdAt" ON "ArquivoEstoqueLoja"("createdAt");

CREATE TABLE IF NOT EXISTS "MovimentacaoEstoqueLoja" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "lojaId" UUID NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "quantidadeAntes" INTEGER NOT NULL DEFAULT 0,
    "quantidadeDepois" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "pedidoId" TEXT,
    "responsavel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_movestoque_lojaId" ON "MovimentacaoEstoqueLoja"("lojaId");
CREATE INDEX IF NOT EXISTS "idx_movestoque_produtoNome" ON "MovimentacaoEstoqueLoja"("produtoNome");
CREATE INDEX IF NOT EXISTS "idx_movestoque_tipo" ON "MovimentacaoEstoqueLoja"("tipo");
CREATE INDEX IF NOT EXISTS "idx_movestoque_createdAt" ON "MovimentacaoEstoqueLoja"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_movestoque_pedidoId" ON "MovimentacaoEstoqueLoja"("pedidoId");

-- ============== IA COMPLETA ==============

CREATE TABLE IF NOT EXISTS "IAChat" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nova Conversa',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB DEFAULT '{}',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("user_id") REFERENCES "User_System"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_iachat_user_id" ON "IAChat"("user_id");
CREATE INDEX IF NOT EXISTS "idx_iachat_updated_at" ON "IAChat"("updated_at" DESC);

CREATE TABLE IF NOT EXISTS "IAMessage" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "chat_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence_order" INTEGER NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("chat_id") REFERENCES "IAChat"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_iamsg_chat_id" ON "IAMessage"("chat_id");
CREATE INDEX IF NOT EXISTS "idx_iamsg_chat_seq" ON "IAMessage"("chat_id", "sequence_order");

-- ============== FISCAL / NFe ==============

-- DadosFiscaisEmpresa
CREATE TABLE IF NOT EXISTS "DadosFiscaisEmpresa" (
    "id"                        TEXT        NOT NULL,
    "company_id"                TEXT        NOT NULL,
    "razao_social"              TEXT        NOT NULL DEFAULT '',
    "nome_fantasia"             TEXT        NOT NULL DEFAULT '',
    "cnpj"                      TEXT        NOT NULL DEFAULT '',
    "inscricao_estadual"        TEXT        NOT NULL DEFAULT '',
    "inscricao_municipal"       TEXT,
    "codigo_regime_tributario"  INTEGER     NOT NULL DEFAULT 1,
    "logradouro"                TEXT        NOT NULL DEFAULT '',
    "numero"                    TEXT        NOT NULL DEFAULT '',
    "complemento"               TEXT,
    "bairro"                    TEXT        NOT NULL DEFAULT '',
    "municipio"                 TEXT        NOT NULL DEFAULT '',
    "uf"                        TEXT        NOT NULL DEFAULT '',
    "cep"                       TEXT        NOT NULL DEFAULT '',
    "codigo_municipio"          TEXT,
    "codigo_pais"               TEXT                 DEFAULT '1058',
    "telefone"                  TEXT,
    "email"                     TEXT,
    "ambiente"                  INTEGER     NOT NULL DEFAULT 1,
    "serie"                     INTEGER     NOT NULL DEFAULT 1,
    "numero_nota_atual"         INTEGER     NOT NULL DEFAULT 1,
    "tipo_certificado"          TEXT,
    "certificado_url"           TEXT,
    "senha_certificado"         TEXT,
    "validade_certificado"      TIMESTAMPTZ,
    "serial_number_certificado" TEXT,
    "csc_id"                    TEXT,
    "csc_token"                 TEXT,
    "modelo_documento"          TEXT                 DEFAULT '55',
    "id_enotas"                 TEXT,
    "emissao_nfe_ativa"         BOOLEAN     NOT NULL DEFAULT true,
    "ativo"                     BOOLEAN     NOT NULL DEFAULT true,
    "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_dados_fiscais_company_id" ON "DadosFiscaisEmpresa"("company_id");

-- ConfiguracaoFiscal
CREATE TABLE IF NOT EXISTS "ConfiguracaoFiscal" (
    "id"                             TEXT        NOT NULL,
    "company_id"                     TEXT        NOT NULL UNIQUE,
    "tipo_emissao"                   INTEGER     NOT NULL DEFAULT 1,
    "forma_pagamento_padrao"         INTEGER     NOT NULL DEFAULT 99,
    "tipo_impressao"                 INTEGER     NOT NULL DEFAULT 1,
    "ncm_padrao"                     TEXT,
    "cfop_saida_estado"              INTEGER,
    "cfop_saida_fora_estado"         INTEGER,
    "cfop_entrada_estado"            INTEGER,
    "cfop_entrada_fora_estado"       INTEGER,
    "aliquota_icms_padrao"           NUMERIC(5,2),
    "aliquota_ipi_padrao"            NUMERIC(5,2),
    "aliquota_pis_padrao"            NUMERIC(5,2),
    "aliquota_cofins_padrao"         NUMERIC(5,2),
    "icms_situacao_tributaria"       TEXT,
    "icms_origem"                    INTEGER,
    "pis_situacao_tributaria"        TEXT,
    "cofins_situacao_tributaria"     TEXT,
    "percentual_aproximado_tributos" NUMERIC(5,2),
    "ibs_cbs_classificacao"          TEXT,
    "backup_automatico"              BOOLEAN              DEFAULT false,
    "dias_retencao_backup"           INTEGER,
    "observacoes"                    TEXT,
    "created_at"                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);

-- PadraoFiscal
CREATE TABLE IF NOT EXISTS "PadraoFiscal" (
    "id"                       TEXT        NOT NULL,
    "company_id"               TEXT        NOT NULL,
    "nome"                     TEXT        NOT NULL DEFAULT '',
    "ncm_padrao"               TEXT,
    "cfop_saida_estado"        INTEGER,
    "cfop_saida_fora_estado"   INTEGER,
    "cfop_entrada_estado"      INTEGER,
    "cfop_entrada_fora_estado" INTEGER,
    "principal"                BOOLEAN     NOT NULL DEFAULT false,
    "ordem"                    INTEGER     NOT NULL DEFAULT 1,
    "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_padrao_fiscal_company_id" ON "PadraoFiscal"("company_id");

-- NfeEmitida
CREATE TABLE IF NOT EXISTS "NfeEmitida" (
    "id"                  TEXT        NOT NULL,
    "company_id"          TEXT        NOT NULL,
    "pedido_id"           TEXT,
    "tipo_operacao"       TEXT        NOT NULL,
    "chave_acesso"        TEXT,
    "numero"              INTEGER     NOT NULL,
    "serie"               INTEGER     NOT NULL,
    "xml_url"             TEXT,
    "pdf_url"             TEXT,
    "data_emissao"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "id_enotas"           TEXT,
    "status"              TEXT        NOT NULL DEFAULT 'pendente',
    "protocolo"           TEXT,
    "motivo_cancelamento" TEXT,
    "data_cancelamento"   TIMESTAMPTZ,
    "valor_total"         NUMERIC(12,2),
    "nome_cliente"        TEXT,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_nfe_emitida_company_id"   ON "NfeEmitida"("company_id");
CREATE INDEX IF NOT EXISTS "idx_nfe_emitida_data_emissao" ON "NfeEmitida"("data_emissao" DESC);

-- CartaCorrecao
CREATE TABLE IF NOT EXISTS "CartaCorrecao" (
    "id"              TEXT        NOT NULL,
    "company_id"      TEXT        NOT NULL,
    "nfe_emitida_id"  TEXT        NOT NULL,
    "id_enotas"       TEXT,
    "sequencia"       INTEGER     NOT NULL DEFAULT 1,
    "texto_correcao"  TEXT        NOT NULL,
    "status"          TEXT        NOT NULL DEFAULT 'pendente',
    "protocolo"       TEXT,
    "data_evento"     TIMESTAMPTZ,
    "xml_url"         TEXT,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id"),
    FOREIGN KEY ("nfe_emitida_id") REFERENCES "NfeEmitida"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_carta_correcao_nfe_id" ON "CartaCorrecao"("nfe_emitida_id");

-- Inutilizacao
CREATE TABLE IF NOT EXISTS "Inutilizacao" (
    "id"             TEXT        NOT NULL,
    "company_id"     TEXT        NOT NULL,
    "id_enotas"      TEXT,
    "serie"          INTEGER     NOT NULL,
    "numero_inicial" INTEGER     NOT NULL,
    "numero_final"   INTEGER     NOT NULL,
    "justificativa"  TEXT        NOT NULL,
    "status"         TEXT        NOT NULL DEFAULT 'pendente',
    "protocolo"      TEXT,
    "xml_url"        TEXT,
    "ano"            INTEGER     NOT NULL,
    "data_evento"    TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_inutilizacao_company_id" ON "Inutilizacao"("company_id");

-- NfeLog
CREATE TABLE IF NOT EXISTS "NfeLog" (
    "id"              TEXT        NOT NULL,
    "company_id"      TEXT        NOT NULL,
    "nfe_emitida_id"  TEXT,
    "acao"            TEXT        NOT NULL,
    "status_code"     INTEGER,
    "erro_codigo"     TEXT,
    "erro_mensagem"   TEXT,
    "payload_enviado" TEXT,
    "resposta_enotas" TEXT,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_nfe_log_company_id"      ON "NfeLog"("company_id");
CREATE INDEX IF NOT EXISTS "idx_nfe_log_nfe_emitida_id"  ON "NfeLog"("nfe_emitida_id");
