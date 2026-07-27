-- Schema do dashboard de embaixadores (SQLite).
-- Ingerimos TUDO; o recorte 2026+ e' aplicado como filtro (coluna in_window).

CREATE TABLE IF NOT EXISTS ambassadors (
    pd_deal_id        INTEGER PRIMARY KEY,
    name              TEXT,
    email             TEXT,
    stage_id          INTEGER,
    stage_name        TEXT,
    is_ativado        INTEGER,          -- etapa = Ativados (324)
    fixo_mensal       REAL,             -- deal.value
    modelo            TEXT,             -- Subsidio/Comissao/Permuta (combinados)
    data_criacao      TEXT,             -- Data Criacao Oportunidade (ISO)
    has_referral      INTEGER,          -- aparece como referenciador em >=1 cliente
    investment_active INTEGER,          -- is_ativado OU has_referral
    synced_at         TEXT
);

CREATE TABLE IF NOT EXISTS referrers (
    referrer_key      TEXT PRIMARY KEY, -- email normalizado (fallback: nome normalizado)
    name              TEXT,
    email             TEXT,
    programa          TEXT,             -- embaixador / parceiro / franquia / indefinido
    registered        INTEGER,          -- esta' no funil 45
    pd_ambassador_id  INTEGER,          -- link p/ ambassadors quando registered
    n_clients         INTEGER,
    n_active          INTEGER,
    mrr_active        REAL,
    synced_at         TEXT
);

CREATE TABLE IF NOT EXISTS clients (
    cio_id                TEXT PRIMARY KEY,
    email                 TEXT,
    referred_name         TEXT,
    referred_email        TEXT,
    referrer_key          TEXT,         -- FK -> referrers
    referred_program      TEXT,         -- valor cru do CIO
    programa              TEXT,         -- classificado
    programa_fonte        TEXT,         -- cio_program / pipedrive_deal / indefinido
    cmv                   REAL,
    active                INTEGER,      -- sem cancelamento (ou cancelamento futuro)
    cancelation_date      TEXT,         -- ISO
    ganho_em              TEXT,         -- Pipedrive won_time (ISO) = ancora lifetime/comissao
    created_at_cio        TEXT,         -- ISO (timestamp estavel de criacao)
    cohort_month          TEXT,         -- YYYY-MM
    in_window             INTEGER,      -- created_at_cio >= cutoff (2026+)
    tier                  INTEGER,
    crm_deal              TEXT,
    pd_pipeline_id        INTEGER,
    registered_ambassador INTEGER,      -- referenciador no funil 45
    synced_at             TEXT,
    FOREIGN KEY (referrer_key) REFERENCES referrers(referrer_key)
);

-- Funil: TODOS os referidos (convertidos ou nao). converted=1 -> e' cliente pagante.
CREATE TABLE IF NOT EXISTS leads (
    cio_id           TEXT PRIMARY KEY,
    email            TEXT,
    referred_name    TEXT,
    referred_email   TEXT,
    referrer_key     TEXT,
    referred_program TEXT,
    programa         TEXT,
    converted        INTEGER,          -- cmv > 0
    cmv              REAL,
    lead_date        TEXT,             -- entrada como lead (created_at_cio)
    ganho_em         TEXT,             -- data de conversao (se convertido)
    cancelation_date TEXT,
    active           INTEGER,
    tier             INTEGER,
    in_window        INTEGER,
    synced_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_referrer ON leads(referrer_key);
CREATE INDEX IF NOT EXISTS idx_leads_window ON leads(in_window);

-- Snapshots mensais para series temporais (preenchido pela camada de metricas).
CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_date     TEXT,
    scope             TEXT,             -- 'programa' ou referrer_key
    period            TEXT,             -- YYYY-MM
    metric            TEXT,
    value             REAL,
    PRIMARY KEY (snapshot_date, scope, period, metric)
);

CREATE INDEX IF NOT EXISTS idx_clients_referrer ON clients(referrer_key);
CREATE INDEX IF NOT EXISTS idx_clients_programa ON clients(programa);
CREATE INDEX IF NOT EXISTS idx_clients_window ON clients(in_window);
