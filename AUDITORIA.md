# Auditoria 360 — Dashboard de ROI do Programa de Embaixadores (Umbler Talk)

**Data:** 2026-07-22 · **Método:** revisão multi-agente (6 analistas paralelos lendo o código real + pesquisa web de metodologia SaaS) com **verificação adversarial** de cada achado crítico/alto contra o código. 31 agentes, 0 erros, 75 achados.
**Escopo:** arquitetura, fluxo de dados, código das métricas, metodologia vs. mercado, reconciliação/atribuição de dados, segurança/privacidade, gaps de decisão e UX.

> Onde a verificação adversarial recalibrou a severidade de um achado (para cima ou para baixo) ou corrigiu um exagero, isso está registrado como **[recalibrado]**. Nada aqui é opinião não-verificada.

---

## Sumário executivo

A **fundação é sólida e acima da média** para o estágio: separação sync (Python) → Supabase → frontend (React) limpa, domínio bem modelado (cohort, comissão, classificação de programa), RLS ligado, e uma tabela de eficiência por embaixador (CAC/LTV/payback) que poucos fazem.

**Mas os números de ROI exibidos hoje estão superestimados por bugs reais** — sobretudo **Custo, Break-even, Net e LTV/CAC**. Recomendação: **não tomar decisão de continuar/cortar/quanto-pagar com base nesses números até os dois críticos serem corrigidos.**

| Severidade | Qtde | Natureza |
|---|---|---|
| 🔴 Crítico | 6 | custo/margem quebram o ROI; segurança de deploy |
| 🟠 Alto | 19 | churn, LTV, concentração, paginação, retenção de receita |
| 🟡 Médio | 33 | atribuição, arquitetura, UX de dados |
| ⚪ Baixo/Info | 17 | limpeza, rótulos, timezone |

---

## 🔴 Críticos

### C1. 93% do custo fixo (R$41k de R$44k/mês) desaparece dos cálculos
- **Confirmado crítico** por 2 analistas independentes + verificação adversarial.
- `ambFixos()` usa `start = ym(a.data_criacao)` e todos os consumidores filtram por `a.start && a.start <= M`. **24 dos 26 embaixadores têm `data_criacao = null`** → descartados silenciosamente de custo, série mensal, break-even e Investimento Total. Só R$3.000/mês entra. O maior fixo — **"Peter-Jordan", R$18.000/mês — contribui R$0.**
- **Evidência:** `metrics.js:62, 67, 216, 240`; `data.json` (só 2 ambassadors com `data_criacao` não-nula).
- **Impacto:** Custo e Break-even drasticamente subestimados. A verificação recalculou: com o fallback correto o break-even acumulado cai de **+R$814k para ~+R$35k** — continua positivo, mas o "o programa se pagou" do FAQ está **inflado ~23×**.
- **Correção:** sync preenche `data_criacao` com fallback (`add_time` do deal do funil 45); `metrics.js` trata `start` ausente como início do recorte (`FLOOR_YM`) em vez de descartar. Validar fixo somado ≈ R$44k.

### C2. Todo o retorno assume margem bruta de 100% (sem COGS)
- **Confirmado alto** por 2 analistas (elevado a crítico no consolidado por afetar toda a camada de ROI).
- LTV, Net, Break-even e CAC Payback usam **receita bruta**. Como a comissão só existe nos 3 primeiros meses, do 4º mês cada cliente vira "100% lucro" → **break-even quase garantido positivo** e **Net quase sempre verde**.
- **Evidência:** `metrics.js:192` (`ltvCac` sem margem), `:241` (break-even sem COGS), `:199` (net), `:193` (payback); `faq.js:49`.
- **Correção:** **margem bruta configurável (padrão 75%)** aplicada a LTV, Net, Break-even e Payback; rotular "com margem".

### C3. Segurança de deploy — signup + duas ideias proibidas
- **RLS `using(true)` + signup:** a policy dá SELECT a **qualquer usuário autenticado**, sem escopo. Se "Allow new users to sign up" (padrão Supabase) estiver ligado, **qualquer um se cadastra e lê toda a PII.** `supabase_schema.sql:107-111`, `Login.jsx:13`. **[recalibrado: latente/condicional — depende de um toggle fora do código]**
- **As duas ideias de "tirar login" são regressões críticas — não implementar:** leitura anônima publica toda a PII; auto-login com senha no `.env` coloca credencial real reutilizável no bundle público (VITE_* é embutido no JS). Caminho seguro: **signup desabilitado + sessão persistida (já persiste) ou magic link.**
- **Chave da Anthropic:** hoje **não vaza** (`VITE_ANTHROPIC_API_KEY` vazia). **Risco latente de deploy** — se preenchida e publicada, vai no bundle. Mover para proxy (Edge Function) antes de publicar.

---

## 🟠 Altos

### A1. Churn inflado ~20 p.p. (59% em vez de 39%)
Numerador (cancelados no período) inclui clientes **ganhos dentro do período**, que não estão no denominador (ativos no início) → razão inconsistente, pode passar de 100%. `metrics.js:101-105`. **Correção:** numerador ⊆ denominador (só quem estava ativo no início). Mesmo ajuste em `monthlySeries` (`:214/220`).

### A2. LTV/lifetime só de clientes já cancelados (viés de sobrevivência)
`lifetime` só soma quem tem `cancelation_date` → subestima a vida e mostra **"—" para os embaixadores com 100% de retenção**. `metrics.js:180-183`. Também no KPI agregado "Lifetime médio" (`:104`). **Correção:** lifetime por `1/churn` (nível programa) ou curva de cohort, incluindo ativos.

### A3. Concentração de risco (dependência do Léo) invisível — [recalibrado de crítico p/ alto]
Sem card/índice nenhum. **Léo = 34% do MRR ativo, top-2 = 59%, top-3 = 67%; o 2º maior (Darlan, 24%) nem é cadastrado.** Inferível na tabela, mas sem enquadramento de risco. `Dashboard.jsx:226-245`. **Correção:** bloco de concentração (share top-1/top-3, HHI, nº que faz 80%) + coluna "% do MRR" na Eficiência.

### A4. Leitura do Supabase sem paginação (corte silencioso em 1000)
Só `leads` pagina; `clients/referrers/ambassadors` usam `.select('*')` sem `.range()`. **`clients` está em 670 e crescendo** — ao passar de 1000, toda métrica subconta sem aviso. `Dashboard.jsx:88`. **Correção:** `fetchAll` nos três.

### A5. `cmv` é snapshot atual, sem histórico
Séries e break-even aplicam o **preço de hoje a todos os meses passados**; inviabiliza NRR/expansão/contração. `sync.py:164`, `metrics.js:207,231`. **Correção:** snapshots mensais de MRR por cliente.

### A6. Falta NRR / GRR / expansão / contração
KPIs-âncora de recorrência ausentes. `mrrSection` só tem new/lost/growth. **GRR já é computável** (`mrrLost/mrrFrom`); NRR depende do histórico de cmv (A5). Fontes: Stripe (NRR>110%, GRR>85%).

### A7. Incrementalidade / canibalização não medida
Comissão paga a **todo** indicado e 100% da receita é creditada como benefício; parte chegaria organicamente. Exige holdout (ação organizacional, não só código); no mínimo documentar a premissa.

### A8. `eficienciaCohort`: CAC inclui fixo, mas Net/Investimento excluem
Mesma linha da tabela: `cac` conta `fixoMensal * monthsInRange` direto, mas `investimentoTotal` usa `monthsSince(data_criacao)=0` (null) → **Net superestimado e incoerente com o CAC**. `metrics.js:182 vs 190`. Corrigido junto de C1.

### A9. Segurança — chave Anthropic no bundle (deploy) + signup (ver C3)
Detalhado em C3. Ação antes de publicar: proxy server-side; não definir `VITE_ANTHROPIC_API_KEY` no frontend.

---

## 🟡 Médios (agrupados)

**Dados / atribuição**
- **Programa do cliente sobreposto pelo do referenciador** → "embaixador" infla 235→339 clientes. **[recalibrado: ~80% é atribuição legítima de tags vazias 2025]**; o defeito real é o campo por-cliente `programa_fonte` **existir e ser ignorado**. `metrics.js:41`, `sync.py:238-243`.
- **Funil mistura 3 fontes** (leads=CIO, negócios=snapshot Pipedrive, ganhos=CIO) → taxas viram artefato de tagueamento, setas podem passar de 100%. E **ignora o filtro de Programa** (fixo em embaixador). `Dashboard.jsx:114-119`.
- **Splits de referenciador** (mesma pessoa, 2 e-mails, +alias/typos) = 2 linhas (6 casos). `sync.py:170`.
- **10 contas internas @umbler.com** contadas como referenciadores (41 clientes).
- **214/670 clientes sem `ganho_em`** → `wonDate` cai para `created_at_cio`, adiantando a janela de comissão. `metrics.js:15`.
- **CAC usa comissão acumulada até hoje**, não os 3 meses comprometidos → safras recentes parecem baratas. `metrics.js:189`.
- **Gap de tag 2025:** 173 clientes `indefinido`, classificados só pelo referenciador.

**Arquitetura**
- **Supabase nunca deleta** (só upsert) → acumula "zumbis". **[recalibrado: cancelamento atualiza in-place; vetores reais = mudança de PK, `cmv→0`, deleções]**. `supa.py:22`.
- **Falhas de API engolidas** (`return {"data": None}`) podem zerar tabelas no SQLite (path do Supabase protegido pelo merge-upsert). `api.py:103`.
- **Sem snapshots históricos reais** (o spec previa) → histórico reescrito a cada sync.
- **Sem migrations/DDL Postgres versionado**, `.env.example` desatualizado, **testes são `console.log` sem asserção**, sync manual (dados defasados), N+1 de ~10k chamadas sequenciais, triplo destino de escrita.

**UX de dados**
- **Três "Taxa de conversão"** com o mesmo rótulo e denominadores diferentes. `metrics.js:141,155,198`.
- **Gráfico "Visão geral" normalizado 0–1**: linhas não comparáveis. `Dashboard.jsx:49-53,183`.
- **MRR ativo e ARPA faltam nos cards de topo**; **ARPA é calculado e nunca renderizado**. `metrics.js:86`.
- **Coluna "Net" quase sempre verde** (sem margem) → não discrimina.
- **CAC Payback:** thresholds `<6/6-12/>12` apresentados como padrão de mercado; benchmark B2B SaaS real é **12–18 meses**. Reposicionar como metas internas.

---

## ⚪ Baixos / limpeza

- `has_referral` mede "tem cliente convertido" (nome invertido); `cohort_month`, `in_window`, `registered_ambassador` **calculados no sync e nunca usados** no dashboard. `sync.py:256`.
- Tabela `snapshots` **mal-rotulada** (design mensal genérico nunca implementado; uso real diário/PD).
- `monthsActive` nunca retorna 0 → cliente cancelado no mesmo dia conta 1 mês de comissão. `metrics.js:34`.
- `saudePrograma` ignora o filtro de período (usa `n_clients` all-time). `metrics.js:117`.
- Timezone misturado (UTC no sync vs. local no frontend) → off-by-one em bordas de dia.
- Cache HTTP sem TTL guarda PII em disco (20,4 MB).
- Break-even conta receita pré-2025 sem a comissão de aquisição (paga antes de 2025).
- `mergeByIndex` alinha comparação por índice, não por mês.
- Mensagens de erro cruas de Supabase/Anthropic na UI.

---

## Metodologia vs. mercado (com fontes pesquisadas)

| Métrica | Veredito | Correção / fonte |
|---|---|---|
| MRR ativo, ARPA, "ativo", New/Lost MRR | ✅ correto | manter (ChartMogul) |
| Conversão simples | ✅ aceitável | trial 7d justifica |
| **LTV** | ⚠️ oversimplified | `ARPA × margem × lifetime`, lifetime por `1/churn`/cohort (ChartMogul, Baremetrics) |
| **CAC Payback** | ⚠️ oversimplified | `CAC / (ARPA × margem)`; benchmark real 12–18 meses (WallStreetPrep, MarketerHire) |
| **LTV/CAC 3×** | ⚠️ benchmark ok, insumos ruins | válido (David Skok); herda erros do LTV; exibir só com massa mínima |
| **CAC** | ⚠️ parcial | comissão acumulada, não comprometida; só o incentivo (não S&M) |
| **Churn** | ⚠️ logo churn só | falta revenue churn (`mrrLost/mrrFrom`) — crítico numa base concentrada |
| **NRR / GRR** | ❌ faltando | GRR já dá; NRR bloqueado por A5 (Stripe) |
| **Retenção por cohort** | ❌ faltando | `cohort_month` existe e não é usado (Stripe) |
| **K-factor / time-to-refer** | ❌ faltando | participation rate já existe (First Round, Viral Loops) |
| **Referido vs. orgânico** | ❌ faltando | sem contrafactual de qualidade do canal |

---

## O que FALTA vs. o que SOBRA

**Falta (por valor de decisão):** bloco de **concentração/HHI**; **GRR** (e NRR com histórico); **curva de retenção por cohort**; **custo por lead / por cliente** no nível programa; **K-factor / time-to-refer**; **referido vs. orgânico**; **MRR ativo + ARPA** nos cards de topo.

**Sobra / limpar:** `has_referral` (nome invertido), `cohort_month`, `in_window`, `registered_ambassador` (calculados e não usados); `snapshots` mal-rotulada; coluna **Net** (sempre verde); **triplo destino** de escrita (fonte de verdade ambígua).

---

## Plano de ação priorizado

1. **Custo/fixo (`data_criacao` null)** — corrige Custo, Break-even, CAC, Net de uma vez.
2. **Margem bruta configurável** em LTV/Net/Break-even/Payback.
3. **Segurança pré-deploy:** signup desabilitado + allowlist na RLS; proxy p/ Anthropic; **não** fazer anon-read nem auto-login.
4. **Churn** (numerador ⊆ denominador) + **paginação** dos 3 fetches.
5. **Concentração de risco** (bloco + coluna % do MRR).
6. **Lifetime sem viés** (1/churn) + **revenue churn / GRR**.
7. Limpeza de dados (splits de e-mail, @umbler.com, `programa_fonte` único) e UX (rótulos de conversão, gráfico normalizado, funil que ignora filtro, MRR ativo+ARPA nos cards).
8. Infra: snapshots mensais de MRR, migrations versionadas, testes com asserção, sync agendado.

---

*Gerado a partir da auditoria multi-agente (`wf_f8fcd23a-d22`). Cada achado tem evidência `arquivo:linha` e passou por verificação adversarial.*
