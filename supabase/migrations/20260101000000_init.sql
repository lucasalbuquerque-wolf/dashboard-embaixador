-- Migration inicial — esquema do dashboard de embaixadores (Postgres/Supabase).
-- Fonte de verdade do schema (auditoria: antes era SQL manual não versionado).
-- Aplicar com: supabase db push   (ou colar no SQL Editor).

create table if not exists ambassadors (
    pd_deal_id        bigint primary key,
    name              text,
    email             text,
    stage_id          integer,
    stage_name        text,
    is_ativado        smallint,
    fixo_mensal       double precision,   -- fixo do Pipedrive (deal value); >0 = tem fixo
    modelo            text,
    data_criacao      text,
    has_referral      smallint,
    investment_active smallint,
    synced_at         text
);

create table if not exists referrers (
    referrer_key     text primary key,
    name             text,
    email            text,
    programa         text,               -- embaixador | parceiro | franquia | interno | indefinido
    registered       smallint,
    pd_ambassador_id bigint,
    n_clients        integer,
    n_active         integer,
    mrr_active       double precision,
    synced_at        text
);

create table if not exists clients (
    cio_id                text primary key,
    email                 text,
    referred_name         text,
    referred_email        text,
    referrer_key          text,
    referred_program      text,
    programa              text,
    programa_fonte        text,
    cmv                   double precision,
    active                smallint,
    cancelation_date      text,
    ganho_em              text,
    created_at_cio        text,
    cohort_month          text,
    in_window             smallint,
    tier                  integer,
    crm_deal              text,
    pd_pipeline_id        integer,
    registered_ambassador smallint,
    synced_at             text
);
create index if not exists idx_clients_referrer on clients(referrer_key);
create index if not exists idx_clients_programa on clients(programa);
create index if not exists idx_clients_window  on clients(in_window);

create table if not exists leads (
    cio_id           text primary key,
    email            text,
    referred_name    text,
    referred_email   text,
    referrer_key     text,
    referred_program text,
    programa         text,
    converted        smallint,
    cmv              double precision,
    lead_date        text,
    ganho_em         text,
    cancelation_date text,
    active           smallint,
    tier             integer,
    in_window        smallint,
    synced_at        text
);
create index if not exists idx_leads_referrer on leads(referrer_key);
create index if not exists idx_leads_window on leads(in_window);

-- snapshots: série longa e genérica. Usos reais hoje:
--   scope='pipedrive'  period='created'/'won'  metric='negocios_embaixador'  (contagem diária)
--   scope='client_mrr' period=<cio_id>         metric='cmv'  (MRR por cliente por mês → NRR)
create table if not exists snapshots (
    snapshot_date text,
    scope         text,
    period        text,
    metric        text,
    value         double precision,
    primary key (snapshot_date, scope, period, metric)
);

-- Segurança (PII): RLS ligado; leitura só para AUTENTICADOS. O sync usa a secret key (ignora RLS).
-- ⚠️ `using (true)` = qualquer autenticado lê tudo. ANTES do deploy público: desabilitar signup
--    e aplicar a migration de hardening (20260722000000_rls_hardening.sql).
alter table ambassadors enable row level security;
alter table referrers   enable row level security;
alter table clients     enable row level security;
alter table leads       enable row level security;
alter table snapshots   enable row level security;

drop policy if exists "auth read ambassadors" on ambassadors;
drop policy if exists "auth read referrers"   on referrers;
drop policy if exists "auth read clients"     on clients;
drop policy if exists "auth read leads"       on leads;
drop policy if exists "auth read snapshots"   on snapshots;

create policy "auth read ambassadors" on ambassadors for select to authenticated using (true);
create policy "auth read referrers"   on referrers   for select to authenticated using (true);
create policy "auth read clients"     on clients     for select to authenticated using (true);
create policy "auth read leads"       on leads       for select to authenticated using (true);
create policy "auth read snapshots"   on snapshots   for select to authenticated using (true);
