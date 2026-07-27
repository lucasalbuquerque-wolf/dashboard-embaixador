# Supabase — schema, migrations e funções

Estrutura do banco versionada (auditoria: antes era SQL manual, não reproduzível).

## Estrutura
- `migrations/20260101000000_init.sql` — schema base: tabelas, índices e RLS (leitura só para autenticados). É a **fonte de verdade** do schema (substitui o antigo `sync/supabase_schema.sql`).
- `functions/ai-proxy/` — Edge Function que faz proxy da Anthropic (mantém a chave no servidor).
- `../sync/supabase_rls_hardening.sql` — **passo opt-in de segurança pré-deploy** (allowlist de e-mails). NÃO está em `migrations/` de propósito, para `db push` não trancar o acesso por engano.

## Aplicar o schema

Com a Supabase CLI:
```bash
supabase link --project-ref <SEU_PROJECT_REF>
supabase db push                 # aplica as migrations pendentes
supabase functions deploy ai-proxy
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
Ou, sem CLI: cole o conteúdo de `migrations/20260101000000_init.sql` no SQL Editor.

## Antes de publicar (deploy público)
1. **Desabilitar signup** em Authentication > Providers/Settings (senão qualquer um se cadastra e lê a PII).
2. Rodar `../sync/supabase_rls_hardening.sql` (edite a lista de e-mails autorizados).
3. Deployar a `ai-proxy` e apontar `VITE_AI_PROXY_URL` no frontend; deixar `VITE_ANTHROPIC_API_KEY` vazio.

## Novas mudanças de schema
Crie um novo arquivo em `migrations/` com prefixo de timestamp crescente
(`YYYYMMDDHHMMSS_descricao.sql`) — nunca edite uma migration já aplicada.
