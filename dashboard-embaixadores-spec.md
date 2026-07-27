# Dashboard de Performance — Programa de Embaixadores Umbler Talk

> Documentação de especificação para construção via Claude Code.
> Esta é a fonte de verdade do **o quê** e do **porquê**. O **como** técnico (schema final, código de sync, dashboard) será construído a partir daqui.

---

## 1. OBJETIVO E CONTEXTO

### O que é
Dashboard que mede o ROI real do programa de embaixadores da Umbler Talk. Embaixadores indicam clientes via link rastreado (`ReferredBy` único por embaixador). O programa investe em cada embaixador via **fixo mensal** e/ou **comissão**, e precisa saber, com dado, se cada embaixador e o programa como um todo se pagam.

### Modelo de remuneração do programa
- **Comissão** = 100% dos 3 primeiros meses de mensalidade do cliente indicado.
- **Fixo mensal** = valor recorrente pago a alguns embaixadores (não todos), registrado no Pipedrive.
- Modelos coexistem: há embaixador só-comissão, só-fixo, e fixo+comissão. A etiqueta no Pipedrive (SUBSÍDIO / COMISSÃO / PERMUTA) indica o modelo.

### Decisões que o dashboard precisa destravar
1. **Por embaixador:** cortar, manter ou escalar o investimento?
2. **Programa agregado:** o canal se paga? Está crescendo?
3. **Funil:** quantos leads cada embaixador traz, quantos convertem, quantos se perdem?

### Quem constrói
Lucas (Gerente de Marketing) via Claude Code. Dashboard 100% em código.

---

## 2. ARQUITETURA TÉCNICA

### Stack
```
Customer.io (API)  ──┐
                     ├──  SUPABASE (PostgreSQL)  ──  DASHBOARD (código)
Pipedrive (API)    ──┘         histórico/snapshots
```

- **Customer.io** — fonte de verdade do cliente (MRR, tier, churn, qual embaixador indicou).
- **Pipedrive** — fonte do embaixador (fixo, status, modelo) e do funil (leads, perdidos, data de fechamento do contrato).
- **Supabase (PostgreSQL)** — armazena histórico e snapshots para permitir comparação mês a mês. Free tier é suficiente.
- **Dashboard** — React/código, lê do Supabase e renderiza.

### Por que Supabase (e não só ler as APIs ao vivo)
As métricas precisam de **histórico** para comparar períodos (MRR mês a mês, evolução de payback, tendência de churn). Customer.io e Pipedrive dão o estado atual, não a série temporal. O Supabase guarda snapshots periódicos que viram a base da comparação.

### NÃO faz parte do stack
- ❌ Coupler.io (descartado)
- ❌ Google Sheets como staging manual (descartado)
- ❌ Looker Studio (descartado)
- ❌ Plataforma de afiliado de terceiros (Rewardful/FirstPromoter) — decisão de build interno

### Fora do escopo desta doc
- **Tracking/atribuição** (cookie ReferredBy server-side, LP por feature, roteamento). É projeto paralelo do time de dev (Guilherme). Afeta os números deste dashboard (ver §9 Pontos de Atenção), mas não é construído aqui.

---

## 3. FONTES DE DADOS

Três fluxos, sem sobreposição. A regra de ouro: **cada dado tem uma única fonte de verdade.**

### 3.1 Customer.io — fonte de verdade do CLIENTE
Workspace ID: `115729`.

| Campo | Uso | Observação |
|-------|-----|------------|
| `email` | Chave de cruzamento com Pipedrive | |
| `referred_name` | Qual embaixador indicou | **Se preenchido, JÁ significa que veio de embaixador.** Não precisa de etiqueta do Pipedrive pra isso. |
| `contract_month_value` | MRR, comissão, LTV, ARPA | Valor mensal do contrato, em R$ |
| `_created_in_customerio_at` | Data de criação da oportunidade (entrada como lead) | **Usar esta, NÃO `created_at`.** `created_at` é volátil (muda, às vezes igual à data de cancelamento). `_created_in_customerio_at` é estável. |
| `cancelation_date` | Churn, fim do lifetime | |
| `tier` | Mix de Tier (1–4) | Porte da empresa do cliente — ver §3.4 |
| `active` | Active Customers, filtro de ativos | |
| `crm_deal` / `crm_person` | IDs do Pipedrive, para cruzar se o email falhar | Backup de cruzamento |

**Validado com dado real:** cliente Amanda (amanda@gobanners.com.br), cio_id `918807c401f09701b189e802`, embaixador Felipe Traina, tier 1, contract_month_value 1032, `_created_in_customerio_at` = 27/01/2026, cancelation_date = 13/05/2026.

### 3.2 Pipedrive — Funil EMBAIXADORES — fonte de verdade do EMBAIXADOR

| Campo (rótulo visto no print) | Uso |
|-------|-----|
| Nome | Identificar embaixador; cruza com `referred_name` do Customer.io |
| E-mail | Identificação |
| Valor | **Fixo mensal** do embaixador |
| Data Criação Oportunidade | Início da parceria (base dos meses de investimento acumulado) |
| Etapa (Ativados / Inativos) | Status do embaixador |
| Etiqueta (SUBSÍDIO / COMISSÃO / PERMUTA) | Modelo de compensação |

> ⚠️ Os nomes acima são **rótulos vistos em prints**. Antes de codar, validar os **nomes/IDs reais dos campos na API do Pipedrive** (ver §11).

### 3.3 Pipedrive — Funil CLIENTES (etiqueta INDICAÇÃO-EMBAIXADOR) — fonte do FUNIL
Entra **apenas** pelo que o Customer.io não tem: os leads que **não** converteram, e a data de fechamento do contrato.

| Campo | Uso |
|-------|-----|
| E-mail | Chave de cruzamento com Customer.io |
| Status (Ganho / Perdido / Aberto) | Numerador/denominador da Taxa de Conversão |
| Data Criação Oportunidade | Leads Novos no período |
| **Ganho em** | **Data de fechamento do contrato** — âncora de lifetime e comissão (ver §6) |

> **NÃO puxar daqui:** valor do contrato, tier, data de cancelamento. Tudo isso vem do Customer.io (fonte de verdade do cliente). Pegar do Pipedrive seria duplicação.

### 3.4 Definição de Tier (porte da empresa do cliente)
Campo `tier` no Customer.io, valores 1–4, baseado em segmentos do Customer.io:

| Tier | Critério |
|------|----------|
| Tier 1 | +10 funcionários **OU** 5-10 funcionários COM site |
| Tier 2 | 5-10 funcionários SEM site **OU** 2-4 funcionários COM site |
| Tier 3 | 2-4 funcionários SEM site **OU** 1 funcionário COM site |
| Tier 4 | 1 funcionário SEM site |

> **Nota:** "Tier" aqui é **porte da empresa**, NÃO plano contratado. Plano (Basic/Professional/Enterprise) é dimensão separada e não é usada como tier. (Houve confusão histórica onde "tier" aparecia como plano — ignorar essa definição.)

---

## 4. CRUZAMENTO DE DADOS

| De | Para | Chave |
|----|------|-------|
| Customer.io (cliente) | Pipedrive Embaixadores | `referred_name` = Nome do embaixador |
| Customer.io (cliente) | Pipedrive Clientes | `email` do cliente |

### Fluxo lógico de um cliente
1. Cliente existe no Customer.io com `referred_name` preenchido — veio de embaixador.
2. Cruza `referred_name` com o Nome no Funil Embaixadores — puxa fixo, status, modelo do embaixador.
3. Cruza `email` com o Funil Clientes — puxa a data "Ganho em" (fechamento do contrato).
4. Com isso calcula lifetime, comissão, contribuição.

### ⚠️ Ponto de atenção: clientes órfãos
Se um cliente do Customer.io **não tiver deal correspondente no Pipedrive Clientes** (email não bate, deal não existe), ele fica **sem data "Ganho em"** — lifetime e comissão dele não calculam. Provavelmente raro, mas existe. O Claude Code deve implementar uma **regra de fallback** (ex.: usar `_created_in_customerio_at` + offset, ou sinalizar o cliente como "sem data de contrato" e excluir dos cálculos que dependem dela, registrando num log). Decisão de fallback a ser tomada na construção.

---

## 5. MÉTRICAS

Cinco blocos: Funil, Receita, Eficiência, Qualidade, Saúde.
Notação: **CMV** = `contract_month_value`. **Período** = recorte de data do filtro.

### 5.1 BLOCO FUNIL
> Mede o topo: volume de indicação antes da conversão. Fonte: Pipedrive Clientes.

| Métrica | O que é | Fórmula | Fonte |
|---------|---------|---------|-------|
| **Leads Novos** | Volume de indicações no período | Count de deals (etiqueta INDICAÇÃO-EMBAIXADOR) com Data Criação Oportunidade dentro do período | Pipedrive Clientes |
| **Taxa de Conversão** | % de leads que viram cliente | Deals Ganhos no período ÷ Leads Novos no período | Pipedrive Clientes |
| **NMRR Vendas** | New MRR dos fechamentos do período | Soma do Valor dos deals com "Ganho em" no período | Pipedrive Clientes |

**Regra da Taxa de Conversão (decidida):** taxa **simples mês a mês** (ganhos do mês ÷ leads do mês). Justificativa: trial de 7 dias é curto — lead e fechamento caem no mesmo mês na maioria dos casos. NÃO usar taxa por coorte.

### 5.2 BLOCO RECEITA
> Fonte: Customer.io (exceto NMRR Vendas, que é do funil).

| Métrica | O que é | Fórmula | Fonte |
|---------|---------|---------|-------|
| **MRR Embaixadores** | Receita recorrente ativa dos referidos | Soma CMV dos clientes ativos com `referred_name` preenchido | Customer.io |
| **New MRR** | Receita de novos clientes no período | Soma CMV dos que tiveram "Ganho em" no período | Customer.io + Pipedrive |
| **MRR Lost** | Receita perdida por cancelamento | Soma CMV dos cancelados no período (`cancelation_date` no período) | Customer.io |
| **Net MRR** | Crescimento líquido | New MRR − MRR Lost | Calculado |
| **ARPA** | Ticket médio dos referidos | MRR ÷ Active Customers | Calculado |

### 5.3 BLOCO EFICIÊNCIA
> O coração da decisão cortar/manter/escalar. Maioria calculada, cruzando fontes.

| Métrica | O que é | Fórmula | Fonte |
|---------|---------|---------|-------|
| **Investimento** | Custo total de um embaixador | (Fixo mensal × meses de parceria) + Comissão Devida | Pipedrive Embaixadores + Customer.io |
| **Comissão Devida** | Comissão acumulada por cliente | Σ por cliente de: CMV × min(meses_ativos, 3) | Customer.io + Pipedrive ("Ganho em") |
| **CPA Embaixadores** | Custo por aquisição | Investimento ÷ New Customers | Calculado |
| **LTV** | Valor do cliente no tempo de vida | ARPA × Customer Lifetime médio dos referidos | Calculado |
| **LTV/CAC** | Eficiência do investimento | LTV ÷ (Investimento ÷ New Customers) | Calculado |
| **Payback Period** | Meses até se pagar | Primeiro mês em que Receita Acumulada > Custo Acumulado | Calculado |
| **Cumulative Net Contribution** | Quanto já gerou líquido | Receita Acumulada − Custo Acumulado (gráfico de linha; cruza zero = payback) | Calculado |

**Benchmarks de decisão:**
- LTV/CAC ≥ 3 → saudável; 1–3 → marginal; < 1 → destrói valor, cortar.
- Payback Period > Customer Lifetime médio → embaixador nunca se paga, cortar (mesmo trazendo cliente).

### 5.4 BLOCO QUALIDADE
> Os clientes indicados são bons? Fonte: Customer.io + cruzamento.

| Métrica | O que é | Fórmula | Fonte |
|---------|---------|---------|-------|
| **Customer Churn** | Velocidade de perda de clientes | Cancelados no período ÷ Ativos no início do período | Customer.io |
| **Net Revenue Churn** | Perda ponderada por valor | MRR Lost ÷ MRR no início do período | Calculado |
| **Customer Lifetime** | Quanto o cliente fica (meses) | Média de (cancelation_date − "Ganho em") dos referidos | Customer.io + Pipedrive |
| **Mix de Tier** | Qualidade do pipeline | Distribuição dos clientes por tier (1–4) | Customer.io |
| **Churn 90 dias** | Churn na janela de comissão | Cancelados nos 3 primeiros meses ÷ total de novos | Customer.io + Pipedrive ("Ganho em") |

> **Por que Churn 90 dias importa:** se o cliente churna nos 3 primeiros meses, você paga comissão (100% dos 3 meses) e perde o cliente = prejuízo direto.

### 5.5 BLOCO SAÚDE DO PROGRAMA
> Visão de gestão do programa como um todo.

| Métrica | O que é | Fórmula | Fonte |
|---------|---------|---------|-------|
| **Active Customers** | Base total de clientes referidos ativos | Count onde active = true e referred_name preenchido | Customer.io |
| **Embaixadores Ativos** | Embaixadores com status ativo | Count onde Etapa = Ativados | Pipedrive Embaixadores |
| **Taxa de Ativação** | % de embaixadores que produziram | Embaixadores com ≥1 cliente ÷ Total de embaixadores | Calculado |

---

## 6. CÁLCULOS DETALHADOS (com âncoras de data)

### Âncora de data — REGRA FECHADA
- **Leads Novos** — conta a partir de `_created_in_customerio_at` (entrada como lead) ou Data Criação Oportunidade do Pipedrive Clientes (entrada no funil). É sobre o **lead**.
- **Lifetime e Comissão** — contam a partir do **"Ganho em" do Pipedrive Clientes** (quando virou cliente pagante). Regra: sem cliente pagante não há valor, sem valor não há comissão nem lifetime. Os dois são sobre o cliente **pagante**, não sobre o lead.

### Investimento (por embaixador, acumulado até o mês t)
```
Investimento(t) = (Fixo_mensal × meses_de_parceria_até_t) + Comissão_Devida_acumulada(t)

meses_de_parceria = de (Data Criação Oportunidade no Funil Embaixadores) até t
```

### Comissão Devida (por cliente)
```
Comissão_Devida_cliente = CMV × min(meses_ativos, 3)

meses_ativos = de ("Ganho em") até (cancelation_date OU hoje, o que vier primeiro)
```
Soma de todos os clientes do embaixador = Comissão Devida total do embaixador.

### Receita Acumulada (por embaixador, até o mês t)
```
Receita_Acumulada(t) = Σ por cliente de: CMV × meses_ativos_até_t

meses_ativos_até_t = de ("Ganho em") até min(t, cancelation_date)
```

### Payback Period
```
Payback = primeiro mês onde Receita_Acumulada(t) > Investimento(t)
Viável se Payback < Customer Lifetime médio do Talk.
```

### LTV/CAC
```
LTV = ARPA × Customer Lifetime médio dos referidos
CAC = Investimento total no embaixador ÷ New Customers do embaixador
LTV/CAC = LTV ÷ CAC
```

### Lógica de payback por modelo de remuneração
- **Só comissão (sem fixo):** estruturalmente positivo a partir do mês 4 de cada cliente (empresa entrega meses 1–3, fica com 4+). Só dá errado se Customer Lifetime médio < 3 meses (problema de qualidade do cliente, não de custo).
- **Fixo + comissão:** payback real e variável. **Regra crítica:** payback tem que caber dentro do Customer Lifetime médio. Embaixador com fixo precisa trazer **coortes recorrentes**, não um pulso único — cada mês sem novo cliente adiciona fixo sem receita nova para compensar.
- **Só fixo:** Payback = quando MRR acumulado > Fixo acumulado. Mais cruel — mês sem indicação aparece direto no gap.

---

## 7. REGRAS DE NEGÓCIO

1. **Identificação de cliente de embaixador:** `referred_name` preenchido no Customer.io. Não depende de etiqueta do Pipedrive.
2. **Taxa de Conversão:** simples, mês a mês (ganhos do mês ÷ leads do mês). Não coorte.
3. **Âncora lifetime/comissão:** "Ganho em" do Pipedrive Clientes.
4. **Janela de comissão:** 3 primeiros meses (`min(meses_ativos, 3)`).
5. **Leads em trial na virada de mês:** trial de 7 dias atravessa a virada para leads do fim do mês. Regra recomendada: **congelar o snapshot da taxa de um mês ~7 dias após o fim do mês**, para que todos os leads daquele mês já tenham desfecho (Ganho/Perdido). Leads ainda Abertos no momento do snapshot: definir se entram no denominador ou aguardam (decisão de implementação).
6. **Diagnóstico de anomalia na taxa:** quando uma taxa mensal vier muito fora da curva, olhar primeiro a **distribuição de entrada de leads no mês** (concentração no fim do mês explica boa parte das anomalias) antes de concluir que o embaixador piorou.

---

## 8. FILTROS DO DASHBOARD

| Filtro | Valores | Função |
|--------|---------|--------|
| Período | intervalo de datas | Recorte temporal de toda métrica; base da comparação mês a mês |
| Embaixador | lista de embaixadores | Programa todo ou um específico |
| Tier do cliente | 1, 2, 3, 4 | Qualidade do pipeline por porte de empresa |
| Status do cliente | ativo / cancelado / todos | Isolar base ativa do churn |

> **Categoria do embaixador (Nano/Micro/Mid/Macro) foi deixada FORA por enquanto.** Não existe em fonte automática; exigiria criar campo no Pipedrive e preencher. Pode ser plugada depois sem quebrar nada.

---

## 9. PONTOS DE ATENÇÃO E RISCOS

### 9.1 Atribuição frágil (subcontagem) — o maior
O `ReferredBy` só é capturado via query string no momento do cadastro; **não persiste em cookie**. Se a pessoa clica no link, fecha, e volta depois (pesquisa Google, LP de IA, outro momento) sem o parâmetro na URL, a atribuição ao embaixador se perde — o cadastro vira "cliente sem origem".

**Consequência para o dashboard:** o `referred_name` só preenche quando a query string sobreviveu até o cadastro. O dashboard **subconta** clientes por embaixador — é um **piso, não o número real**. Penaliza mais os embaixadores cujo público pesquisa a marca depois (justamente os de maior awareness).

Isso é corrigido no projeto paralelo de tracking (fora desta doc). Aqui, registrar a ressalva: **todos os números por embaixador são piso.**

### 9.2 Clientes órfãos
Cliente no Customer.io sem deal correspondente no Pipedrive Clientes — sem "Ganho em" — lifetime e comissão não calculam. Precisa de regra de fallback (ver §4).

### 9.3 Descasamento temporal da Taxa de Conversão
Taxa simples mistura coortes nas bordas do mês (lead de um mês, fechamento no seguinte). Mitigado pela regra de congelar snapshot ~7 dias após o fim do mês (§7.5). Ruído pequeno dado o trial de 7 dias, mas existe.

### 9.4 Dependência de validação de campos no Pipedrive
Os nomes de campo usados aqui são rótulos de prints. Os nomes/IDs reais na API precisam ser confirmados antes de codar o sync (§11).

### 9.5 Categoria fora do escopo
Filtro por porte de criador não existe até criar e preencher o campo. Registrado, não bloqueante.

---

## 10. O QUE JÁ ESTÁ DECIDIDO (resumo)

- ✅ Stack: Customer.io + Pipedrive + Supabase + dashboard em código. Sem Coupler/Sheets/Looker/plataforma externa.
- ✅ Métricas: 5 blocos (Funil, Receita, Eficiência, Qualidade, Saúde) — lista fechada.
- ✅ Funil entra (Leads Novos, Taxa de Conversão simples mês a mês, perdidos).
- ✅ Âncora lifetime/comissão: "Ganho em" do Pipedrive.
- ✅ Data de lead: `_created_in_customerio_at` (não `created_at`).
- ✅ Fontes sem sobreposição (cada dado uma fonte de verdade).
- ✅ Cruzamento: `referred_name` → Nome; `email`.
- ✅ Tier = porte da empresa (1–4) via Customer.io.
- ✅ Filtros: Período, Embaixador, Tier, Status.
- ✅ Categoria do embaixador: fora por enquanto.

---

## 11. PASSOS QUE FALTAM (antes e durante a construção)

### Antes de codar
1. **Validar nomes/IDs reais dos campos na API do Pipedrive** — tanto Funil Embaixadores quanto Funil Clientes. Os rótulos desta doc são de prints, não da API.
2. **Confirmar acesso/API keys:** Customer.io (App API Key — pedir ao Murilo se necessário) e Pipedrive.
3. **Confirmar como identificar o Funil Clientes na API** — a etiqueta INDICAÇÃO-EMBAIXADOR é um label; confirmar o ID/filtro real.

### Construção (ordem sugerida — Claude Code decide o schema)
4. **Schema do Supabase** — Claude Code projeta as tabelas. Necessidades a cobrir:
   - Tabela de clientes referidos (sync do Customer.io).
   - Tabela de embaixadores (sync do Pipedrive Embaixadores).
   - Tabela de deals/funil (sync do Pipedrive Clientes — para leads, perdidos, "Ganho em").
   - Tabela(s) de snapshot/histórico — 1 registro por embaixador (ou por programa) por período, para permitir comparação mês a mês e séries temporais (MRR, payback, churn ao longo do tempo).
   - Considerar importar o histórico mensal já existente (planilha com MRR, churn, ARPA, LTV, Net Revenue Churn etc. desde 2024) como ponto de partida da série.
5. **Script de sync** — puxa Customer.io + Pipedrive, faz upsert no Supabase, calcula métricas agregadas, grava snapshot com timestamp. Scheduler diário/semanal.
6. **Regra de fallback para clientes órfãos** (§4).
7. **Regra de congelamento de snapshot da taxa** (§7.5).
8. **Dashboard** — lê do Supabase, aplica filtros (§8), renderiza os 5 blocos.

### Pendência de dado (não bloqueia o dashboard)
9. **Tracking/atribuição** (cookie ReferredBy server-side + LP por feature) — projeto paralelo do time de dev. Enquanto não feito, números por embaixador são piso (§9.1).

---

*Fim da especificação. A partir daqui, construção via Claude Code.*
