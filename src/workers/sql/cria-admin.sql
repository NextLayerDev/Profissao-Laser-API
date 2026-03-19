-- ============================================
-- Script SQL para criar Company + usuario admin
-- Placeholders substituidos em runtime:
--   {{COMPANY_NAME}} = nome da empresa
--   {{PLAN}}         = PRATA | OURO | PLATINA
--   {{ADMIN_EMAIL}}  = admin@{slug}.com
--   {{ADMIN_PASSWORD}} = senha gerada
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Criar Company do tenant
INSERT INTO "Company" (
    "id",
    "name",
    "status",
    "plan",
    "payment_status",
    "profissao_laser",
    "only_profissao",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid(),
    '{{COMPANY_NAME}}',
    'active',
    '{{PLAN}}',
    'paid',
    true,
    {{ONLY_PROFISSAO}},
    NOW(),
    NOW()
);

-- Criar usuario admin com permissoes completas
INSERT INTO "User_System" (
    "id",
    "email",
    "nome",
    "cargo",
    "senha",
    "ativo",
    "data_criacao",
    "data_edicao",
    "permissoes",
    "companyId"
) VALUES (
    gen_random_uuid(),
    '{{ADMIN_EMAIL}}',
    'Administrador',
    'administrador',
    crypt('{{ADMIN_PASSWORD}}', gen_salt('bf')),
    true,
    NOW(),
    NOW(),
    '{
        "rh": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gestao de funcionarios"},
        "custos": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gerenciar custos e despesas"},
        "perdas": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gerenciar perdas de produtos"},
        "vendas": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Criar e gerenciar pedidos"},
        "estoque": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gerenciar produtos e inventario"},
        "omni": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Sistema de mensagens internas"},
        "aiprevias": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gestao de IA"},
        "dashboard": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Visualizar painel principal e metricas"},
        "financeiro": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Controle financeiro e transacoes"},
        "relatorios": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Gerar e visualizar relatorios"},
        "configuracoes": {"canEdit": true, "canView": true, "canAdmin": true, "canPrice": true, "description": "Configuracoes do sistema"}
    }'::jsonb,
    (SELECT "id" FROM "Company" ORDER BY "createdAt" DESC LIMIT 1)
)
ON CONFLICT ("email") DO UPDATE SET
    "nome" = EXCLUDED."nome",
    "cargo" = EXCLUDED."cargo",
    "senha" = EXCLUDED."senha",
    "ativo" = EXCLUDED."ativo",
    "data_edicao" = NOW(),
    "permissoes" = EXCLUDED."permissoes";
