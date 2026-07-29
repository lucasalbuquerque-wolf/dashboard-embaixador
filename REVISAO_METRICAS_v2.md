# Revisão de métricas v2 — cronograma completo

Origem: Lucas apontou ~13 problemas e pediu para **validar contra Pipedrive + Customer.io antes de mudar**, organizar de forma coerente e criar um cronograma com subagentes e etapas. Este doc é o plano. **Nada de código muda antes do OK do Lucas.**

---

## 0. O que JÁ validei ao vivo (fatos, não achismo)

Consultei o Pipedrive (funil 45) e o data.json (fonte do dashboard) agora:

| Ponto | Dashboard hoje | Fonte real | Veredito |
|---|---|---|---|
| "Cadastrados" | **29** | Funil 45 = 29 deals, mas só **23 em "Ativados"** (2 Demonstração, 2 Negociação, 2 Onboarding) | **BUG de rótulo** — conta o funil inteiro, não os ativos. Lucas certo. |
| Embaixadores com fixo | — | **19** dos 29 têm `value>0` (fixo = valor do deal) | precisa virar métrica |
| Referrers embaixador (indicaram) | 30 (comentário antigo) | **31** total, **13** cadastrados, **20** com cliente | número mudou com o sync fresco |
| Referrers parceiro | — | **121** total, **88** com cliente, 0 "cadastrados" (cadastro só existe no funil de embaixador) | base do "revisar parceiros" |
| Leads embaixador (histórico) | — | **8.839** (todos indicados, todos os anos) | dashboard filtra 2026 → cai muito |
| Leads parceiro (histórico) | — | **609** | validar contra fonte |
| Cancelamentos 62 vs 101 | 62 (churn) e 101 (cancelados) | 62 = ativos no início que cancelaram; 101 = **todos** que cancelaram no período | **não é bug, são bases diferentes** — mas confuso, precisa reconciliar na tela |

Acesso ao vivo às duas fontes **funciona** (via `sync/api.py`) — então dá pra validar tudo de verdade.

---

## 1. Suas questões, organizadas em 8 frentes

**F1 — Contagem de embaixadores (saúde) está errada/confusa**
- "Cadastrados 29" conta o funil inteiro; só 23 são Ativados. (VALIDADO)
- Distinção cadastrado/sem-cadastro confusa.
- Você quer um painel coerente: **Total geral · Ativos total · Ativos que indicam · Geral que indicam · Ativos que ganham fixo · etc.**

**F2 — Cancelamentos inconsistentes (62 vs 101)**
- Reconciliar e deixar claro na tela qual é qual. (VALIDADO: 62 ⊆ 101)

**F3 — Churn mensal e Lifetime**
- Churn mensal: validar se a fórmula está certa.
- Lifetime "7–11 meses" não comunica nada — precisa de uma representação que signifique algo.

**F4 — Leads: Pipedrive ≠ Customer.io (diferença grande)**
- Entender e validar por que a divergência; está certo?
- Leads de parceiro não batem.

**F5 — Custo por lead está errado**
- Seu argumento: deveria ser **só o fixo** (comissão só existe se fechar — e aí é cliente, não lead). Hoje é (fixo+comissão)/leads. **Concordo em revisar.**

**F6 — Tabela de Eficiência**
- Trocar nome por **e-mail** (embaixador e parceiro).
- **Todos** os embaixadores devem aparecer (falta gente).
- **Parceiros** também devem aparecer (por e-mail).
- Abreviar colunas: New customer → **New cust.**, Investimento total → **Invest. total**, Lead→cliente → **% conv.**

**F7 — Parceiros: revisar tudo**
- Nenhum dado bate com Pipedrive/CIO. Reconciliação completa.

**F8 — Impacto cruzado (validar, suspeita de erro)**
- Como F1–F7 influenciam **ARPA, Net, NRR, MRR, GRR**. Validar cada um contra o CIO.

---

## 2. Decisões que preciso de você (definições — antes de codar)

| # | Decisão | Minha recomendação |
|---|---|---|
| D1 | "Embaixador" headline = Ativos (23) ou Funil (29)? | **Ativos (23)** como número principal; "no funil (29)" e "em processo (6)" como apoio |
| D2 | Custo por lead = só fixo? | **Sim** — custo por lead = fixo ÷ leads. Custo por cliente = (fixo+comissão) ÷ clientes |
| D3 | Como mostrar Lifetime? | Trocar "7–11 meses" por: **mediana X meses** + **% que chega ao mês 6/12** (curva concreta, não faixa) |
| D4 | Painel de saúde — quais linhas exatamente | Ver matriz proposta na Fase 2 abaixo |

---

## 3. Cronograma em fases (com subagentes)

### FASE 0 — Validação contra as fontes (subagentes read-only, **não muda nada**)
Cada subagente valida um domínio contra Pipedrive + Customer.io ao vivo e devolve um relatório estruturado de divergências. Rodam em paralelo.

- **SA-1 · Roster de embaixadores** — Funil 45: total, por estágio, quais têm fixo (value), modelo. Cruzar com tabela `ambassadors` e com os referrers CIO. Entregar a matriz: no funil / ativos / com fixo / que indicaram / que geraram cliente. Apontar toda divergência com `saudePrograma`.
- **SA-2 · Leads de embaixador** — reconciliar CIO (indicados, programa embaixador) × leads do dashboard × deals Pipedrive (funil 25, etiqueta INDICAÇÃO-EMBAIXADOR). Explicar e quantificar a diferença CIO↔Pipedrive por período (2026). Validar o card do funil.
- **SA-3 · Parceiros (completo)** — reconciliar CIO programa=parceiro (121 referrers / 609 leads / clientes) × Pipedrive parceiro. Validar TODO número de parceiro do dashboard e achar por que "nada bate".
- **SA-4 · Cancelamentos / churn / lifetime** — do CIO (cmv, cancelation_date), reconciliar 62 vs 101, validar a fórmula de churn mensal e o lifetime; checar formatos de data de cancelamento.
- **SA-5 · Receita (MRR / ARPA / GRR / NRR / Net)** — somar cmv do CIO e validar cada métrica; medir como as correções de F1/F4 mexem nelas.
- **SA-6 · Custo / CAC / custo-por-lead** — validar o modelo de custo, a redefinição "custo por lead = fixo", e a comissão comprometida no CAC.

**Saída da Fase 0:** um relatório único "esperado × dashboard × delta" por métrica. Aí decidimos D1–D4 com números na mão.

### FASE 1 — Fechar definições (com você)
Revisar o relatório da Fase 0 + bater o martelo em D1–D4.

### FASE 2 — Métricas (`metrics.js`)
- Reescrever `saudePrograma` no painel coerente (matriz proposta):
  - **No funil** (29) · **Ativos** (23) · **Em processo** (6)
  - **Com fixo** (19) · investimento fixo total R$/mês
  - **Que indicaram** (geral 31 / ativos ∩ indicaram) · **que geraram cliente** (20)
  - **Sem cadastro que indicaram** (mantém, renomeado p/ clareza)
- `custoPorLead` = fixo ÷ leads (D2).
- Reconciliar cancelamentos (expor 62 e 101 com rótulos claros).
- `eficienciaCohort`: incluir **todos** os indicadores (com e sem cliente no período) e aceitar parceiro.
- Lifetime: nova saída (mediana + % sobrevivência) (D3).
- Ajustar o que a Fase 0 apontar em MRR/ARPA/GRR/NRR.

### FASE 3 — UI (`Dashboard.jsx`)
- Tabela Eficiência: coluna **e-mail** (fallback nome), colunas abreviadas (New cust. / Invest. total / % conv.), **todos** embaixadores + **parceiros**.
- Novo painel de saúde.
- Card de cancelamentos com os dois números explicados.
- Lifetime na nova forma.

### FASE 4 — Parceiros (dado + UI)
- Aplicar as correções da SA-3 (o que estiver errado no sync/escopo de parceiro).
- Garantir que "Por programa" e a Eficiência batem com Pipedrive/CIO para parceiro.

### FASE 5 — Validação final + deploy
- Re-rodar SA-1..6 confirmando dashboard = fontes (delta ≈ 0).
- `npm run build`, testes, commit, push (deploy automático).

---

## 4. Ordem sugerida / esforço
Fase 0 (validação) primeiro — é o coração do "não faça da sua cabeça". Depois 1→5. Fases 2–4 mexem em `metrics.js` + `Dashboard.jsx`; nenhuma toca no backend/sync a não ser que a SA-3 (parceiros) exija.
