// Cálculo das métricas no navegador, sobre a base do Supabase.
// Programa/cadastro de cada cliente/lead vêm do REFERENCIADOR dele.
// Período = intervalo de datas { from, to } em 'YYYY-MM-DD'.

export const money = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR')
export const pct = (n) => (n == null ? '—' : (n * 100).toFixed(1) + '%')
export const num1 = (n) => (n == null ? '—' : n.toFixed(1))

const MS_MONTH = 30.44 * 86400 * 1000
// Piso de TODOS os cálculos: janeiro/2026. Esquecemos 2025 (tag incompleta e fora de escopo).
// Fixo é contado a partir daqui para todo embaixador cadastrado (a data exata no Pipedrive não importa).
const FLOOR_YM = '2026-01'
const FLOOR_DATE = FLOOR_YM + '-01'
// Margem bruta do serviço. 1 = usa a RECEITA CHEIA (decisão do Lucas: não descontar COGS).
// Para passar a usar contribuição (descontando custo de servir), basta trocar para ex. 0.75 —
// aplica automaticamente a LTV, Net, Break-even e CAC Payback.
export const GROSS_MARGIN = 1
const D = (iso) => (iso ? new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso) : null)
const day = (iso) => (iso ? iso.slice(0, 10) : null)
const ym = (iso) => (iso ? iso.slice(0, 7) : null)

export const wonDate = (c) => c.ganho_em || c.created_at_cio
export const inRange = (iso, r) => { const d = day(iso); return !!d && d >= r.from && d <= r.to }
const activeAsOf = (c, to) => {
  const s = day(wonDate(c)); if (!s || s > to) return false
  return !c.cancelation_date || day(c.cancelation_date) > to
}
function dayBefore(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
function nextYm(s) { let [y, m] = s.split('-').map(Number); m++; if (m > 12) { m = 1; y++ } return `${y}-${String(m).padStart(2, '0')}` }
function monthsBetweenYm(a, b) { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am) }
function monthRange(fromYm, toYm) {
  const lo = fromYm < FLOOR_YM ? FLOOR_YM : fromYm
  const out = []; let cur = lo
  while (cur <= toYm && out.length < 120) { out.push(cur); cur = nextYm(cur) }
  return out
}
export function monthsActive(c, asOf) {
  const start = D(wonDate(c)); if (!start) return 0
  const cancel = D(c.cancelation_date)
  const end = cancel && cancel < asOf ? cancel : asOf
  return end <= start ? 1 : Math.max(1, Math.round((end - start) / MS_MONTH))
}
export function monthsSince(iso, asOf) { const s = D(iso); return s ? Math.max(0, Math.round((asOf - s) / MS_MONTH)) : 0 }

// ---- anotação e escopo --------------------------------------------------
// Programa/cadastro vêm do REFERENCIADOR (regra do Lucas: um referenciador = UM programa; só 4 de
// 216 têm tags mistas e a maioria resolve — Darlan 2738 emb vs 2 par etc.). A classificação do
// referenciador é feita no sync (build_referrers: roster do funil 45→embaixador / 46→parceiro,
// senão a MAIORIA real das tags; @umbler → interno, fora dos programas).
export function annotate(items, referrers) {
  const ref = Object.fromEntries(referrers.map((r) => [r.referrer_key, r]))
  return items.map((c) => ({ ...c, _programa: ref[c.referrer_key]?.programa || 'indefinido', _registered: !!ref[c.referrer_key]?.registered }))
}
export const annotateLeads = annotate
export function scopeClients(items, f) {
  return items.filter((c) => {
    if (f.programa !== 'todos' && c._programa !== f.programa) return false
    if (f.registered === 'cadastrado' && !c._registered) return false
    if (f.registered === 'naocad' && c._registered) return false
    if (f.tier !== 'todos' && String(c.tier) !== String(f.tier)) return false
    return true
  })
}
export const scopeLeads = scopeClients
export function leadsByReferrer(leads, range) {
  const m = {}
  for (const l of leads) if (!range || inRange(l.lead_date, range)) m[l.referrer_key] = (m[l.referrer_key] || 0) + 1
  return m
}

// ---- custo do programa (fixo + comissão), mês a mês ---------------------
function ambFixos(ambassadors) {
  // Regra (confirmada com Lucas): fixo SÓ para embaixadores em "Ativados" (is_ativado) E que têm
  // valor de fixo (fixo_mensal>0 — cada um tem o SEU; permuta / só-comissão têm 0 e saem sozinhos).
  // Conta a partir do PISO jan/2026 (esquece 2025): quem já tinha fixo em 2025 passa a contar só de
  // jan/2026; quem entrou em 2026 conta do mês de entrada (o loop de meses começa no piso, então
  // 'start' anterior a jan/2026 é clampado para jan/2026; nunca conta antes de o embaixador existir).
  return (ambassadors || []).filter((a) => a.is_ativado && (a.fixo_mensal || 0) > 0)
    .map((a) => ({ fixo: a.fixo_mensal, start: ym(a.data_criacao) || FLOOR_YM }))
}
function monthlyFixo(ambassadors, M) {
  return ambFixos(ambassadors).filter((a) => a.start && a.start <= M).reduce((s, a) => s + a.fixo, 0)
}
function monthlyCommission(clients, M) {
  return clients.filter((c) => { const s = ym(wonDate(c)), e = ym(c.cancelation_date); return s && s <= M && (!e || e > M) && monthsBetweenYm(s, M) < 3 })
    .reduce((s, c) => s + (c.cmv || 0), 0)
}
function monthlyCost(clients, ambassadors, M) { return monthlyCommission(clients, M) + monthlyFixo(ambassadors, M) }
function daysInMonth(M) {
  const [y, mo] = M.split('-').map(Number)
  return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
}
// Fração do mês M coberta por [range.from, range.to] (0..1). Mês cheio → 1; recorte parcial → proporcional aos dias.
function monthFraction(M, range) {
  const first = M + '-01', last = M + '-' + String(daysInMonth(M)).padStart(2, '0')
  const lo = range.from > first ? range.from : first
  const hi = range.to < last ? range.to : last
  if (hi < lo) return 0
  return (Number(hi.slice(8, 10)) - Number(lo.slice(8, 10)) + 1) / daysInMonth(M)
}
// Custo do período com PRORATA por dias (decisão do Lucas): fixo e comissão do mês são
// contados na proporção dos dias cobertos — um recorte de 1 dia não conta o mês inteiro.
function periodCost(clients, ambassadors, range) {
  return monthRange(range.from.slice(0, 7), range.to.slice(0, 7))
    .reduce((s, M) => s + monthlyCost(clients, ambassadors, M) * monthFraction(M, range), 0)
}
// SÓ o fixo do período (sem comissão), prorateado — base do "custo por lead" (decisão do Lucas:
// o lead só custa o fixo; a comissão só existe se fechar, e aí já é cliente, não lead).
function periodFixo(ambassadors, range) {
  return monthRange(range.from.slice(0, 7), range.to.slice(0, 7))
    .reduce((s, M) => s + monthlyFixo(ambassadors, M) * monthFraction(M, range), 0)
}
// Duração da janela em MESES por dias reais (não buckets de mês-calendário) — usado para
// normalizar churn e GRR acumulados para taxa mensal equivalente, comparável entre janelas.
function windowMonths(range) {
  const days = (D(range.to) - D(range.from)) / 86400000 + 1
  return Math.max(0.03, days / 30.44)
}

// ---- KPIs do período (cards do topo) ------------------------------------
export function computeKpis(clients, leads, ambassadors, range) {
  const activeC = clients.filter((c) => activeAsOf(c, range.to))
  const ganhosC = clients.filter((c) => inRange(wonDate(c), range))
  const cancelC = clients.filter((c) => inRange(c.cancelation_date, range))
  const nLeads = leads.filter((l) => inRange(l.lead_date, range)).length
  const mrrAtivo = activeC.reduce((s, c) => s + (c.cmv || 0), 0)
  const newMrr = ganhosC.reduce((s, c) => s + (c.cmv || 0), 0)
  const custo = Math.round(periodCost(clients, ambassadors, range))
  const custoFixo = Math.round(periodFixo(ambassadors, range))
  return {
    leads: nLeads, ganhos: ganhosC.length, custo, custoFixo,
    cancelados: cancelC.length, newMrr,
    taxaConversao: nLeads ? ganhosC.length / nLeads : null,
    clientesAtivos: activeC.length, mrrAtivo, arpa: activeC.length ? mrrAtivo / activeC.length : 0,
    custoPorLead: nLeads ? custoFixo / nLeads : null,      // SÓ FIXO ÷ leads (comissão só existe se fechar)
    custoPorCliente: ganhosC.length ? custo / ganhosC.length : null, // (fixo+comissão) ÷ novos clientes
  }
}

// ---- Curva de retenção (sobrevivência) por meses desde a aquisição (auditoria) ----
// % de clientes ainda ativos N meses após virarem cliente. Right-censored: no mês k só
// contam clientes que já tiveram a chance de chegar lá (idade >= k).
// Tempo real de vida em meses (float, SEM arredondar para 1) — para retenção precisa no início.
function tenureMonths(c, asOf) {
  const s = D(wonDate(c)); if (!s) return 0
  const cancel = D(c.cancelation_date)
  const end = cancel && cancel < asOf ? cancel : asOf
  return Math.max(0, (end - s) / MS_MONTH)
}
export function retentionCurve(clients, asOf, offsets = [0, 1, 2, 3, 6, 9, 12]) {
  return offsets.map((k) => {
    let elig = 0, ret = 0
    for (const c of clients) {
      const start = D(wonDate(c)); if (!start) continue
      if ((asOf - start) / MS_MONTH < k) continue        // não teve chance de chegar ao mês k
      elig++
      if (tenureMonths(c, asOf) >= k) ret++              // sobreviveu ao menos k meses (tempo real)
    }
    return { offset: k, pct: elig ? ret / elig : null, n: elig }
  })
}

// Taxa de desconto mensal do LTV (valor do dinheiro no tempo, ~12,7%/ano). Ajuste único aqui.
export const LTV_DISCOUNT_MONTHLY = 0.01
// Vida média pela CURVA de retenção (Kaplan-Meier), COM desconto e COM extrapolação de cauda.
// Método correto p/ LTV/CAC: integra a área observada e extrapola o rabo pelo hazard tardio
// (os sobreviventes do cliff do mês 4 têm churn baixo e vivem muito). Sem a cauda, subestima.
export function curveLifetime(clients, asOf, disc = LTV_DISCOUNT_MONTHLY, tail = true) {
  const rc = retentionCurve(clients, asOf, [0, 1, 2, 3, 4, 5, 6, 9, 12]).filter((p) => p.pct != null)
  if (rc.length < 2) return null
  let life = 0
  for (let i = 1; i < rc.length; i++) {
    const dx = rc[i].offset - rc[i - 1].offset
    const surv = (rc[i].pct + rc[i - 1].pct) / 2               // sobrevivência média no intervalo
    const mid = (rc[i].offset + rc[i - 1].offset) / 2
    life += dx * surv / Math.pow(1 + disc, mid)                // descontada pelo mês central
  }
  if (!tail) return life                                       // só a área observada (piso, ~mediana)
  // cauda: extrapola do último ponto com o hazard tardio observado (exponencial)
  const last = rc[rc.length - 1], prev = rc[rc.length - 2]
  const dxL = last.offset - prev.offset
  const tailH = prev.pct > 0 ? Math.min(0.5, Math.max(0.005, 1 - Math.pow(last.pct / prev.pct, 1 / dxL))) : 0.1
  let S = last.pct, m = last.offset
  while (S > 0.02 && m < 60) { S *= (1 - tailH); m++; life += S / Math.pow(1 + disc, m) }
  return life
}

// Resumo de lifetime que COMUNICA (decisão do Lucas: "7-11 meses não me diz nada").
// Devolve mediana de sobrevivência (onde a curva cruza 50%) + % que chega a 6 e 12 meses.
export function lifetimeSummary(clients, asOf) {
  const rc = retentionCurve(clients, asOf, [0, 1, 2, 3, 4, 5, 6, 9, 12]).filter((p) => p.pct != null)
  const at = (k) => { const p = rc.find((x) => x.offset === k); return p ? p.pct : null }
  let median = null
  for (let i = 1; i < rc.length; i++) {
    const a = rc[i - 1], b = rc[i]
    if (a.pct >= 0.5 && b.pct < 0.5) {                    // interpola onde cruza 50%
      median = a.offset + (b.offset - a.offset) * (a.pct - 0.5) / (a.pct - b.pct)
      break
    }
  }
  return { median, s6: at(6), s12: at(12), mean: curveLifetime(clients, asOf) }
}

// Heatmap de retenção POR SAFRA (cohort de aquisição). Linhas = mês em que viraram cliente;
// colunas = % ainda ativo N meses depois. Célula null = safra ainda não teve N meses para envelhecer.
export function cohortRetentionMatrix(clients, asOf, offsets = [0, 1, 2, 3, 6]) {
  const nowYm = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`
  const byCohort = {}
  for (const c of clients) {
    const s = wonDate(c); if (!s) continue
    const m = ym(s); if (m < FLOOR_YM) continue
    ;(byCohort[m] ||= []).push(c)
  }
  return Object.keys(byCohort).sort().map((m) => ({
    cohort: m, n: byCohort[m].length,
    cells: offsets.map((k) => {
      if (monthsBetweenYm(m, nowYm) < k) return { offset: k, pct: null }   // ainda não envelheceu k meses
      const ret = byCohort[m].filter((c) => tenureMonths(c, asOf) >= k).length
      return { offset: k, pct: byCohort[m].length ? ret / byCohort[m].length : null }
    }),
  }))
}
export const RET_OFFSETS = [0, 1, 2, 3, 6]

// ---- Seção MRR ----------------------------------------------------------
export function mrrSection(clients, range) {
  const mrrAtivo = clients.filter((c) => activeAsOf(c, range.to)).reduce((s, c) => s + (c.cmv || 0), 0)
  const base = clients.filter((c) => activeAsOf(c, dayBefore(range.from)))       // base ativa no início
  const mrrFrom = base.reduce((s, c) => s + (c.cmv || 0), 0)
  const newMrr = clients.filter((c) => inRange(wonDate(c), range)).reduce((s, c) => s + (c.cmv || 0), 0)
  const mrrLost = clients.filter((c) => inRange(c.cancelation_date, range)).reduce((s, c) => s + (c.cmv || 0), 0)
  // FIX (auditoria A6): revenue churn / GRR sobre a BASE que existia no início (não inclui novos).
  const mrrLostBase = base.filter((c) => inRange(c.cancelation_date, range)).reduce((s, c) => s + (c.cmv || 0), 0)
  const grossMrrChurn = mrrFrom ? mrrLostBase / mrrFrom : null
  const grr = mrrFrom ? (mrrFrom - mrrLostBase) / mrrFrom : null
  // FIX (revisão): GRR/revenue-churn ACUMULADOS dependem da janela (7m dá ~62%, parece ruim vs
  // benchmark mensal de 85-95%). Normaliza para MENSAL equivalente, igual ao churn de contagem.
  const wMonths = windowMonths(range)
  const revChurnMonthly = grossMrrChurn != null && grossMrrChurn < 1 ? 1 - Math.pow(1 - grossMrrChurn, 1 / wMonths) : grossMrrChurn
  const grrMonthly = revChurnMonthly != null ? 1 - revChurnMonthly : null
  return {
    mrrAtivo, mrrLost, mrrLostBase, netGain: newMrr - mrrLost,
    mrrGrowth: mrrFrom ? (mrrAtivo - mrrFrom) / mrrFrom : null,
    grossMrrChurn, grr,                 // acumulados do período (rótulo deve dizer "no período")
    revChurnMonthly, grrMonthly,        // equivalentes MENSAIS (comparáveis com benchmark)
  }
}

// Lifetime médio SEM viés de sobrevivência (auditoria A2): 1/churn mensal sobre TODOS os
// clientes (não só os já cancelados). Sem churn observado → piso = tenure médio atual.
export function programLifetime(clients, asOf) {
  let months = 0, churn = 0, n = 0
  for (const c of clients) { const m = monthsActive(c, asOf); if (m > 0) { months += m; n++; if (c.cancelation_date) churn++ } }
  if (!n) return null
  const rate = churn / months          // cancelamentos por cliente-mês ≈ churn mensal
  return rate > 0 ? 1 / rate : months / n
}

// ---- Movimentos de MRR / NRR (a partir dos snapshots por cliente, auditoria A6/A5) ----
// Diffa o cmv por cliente entre dois meses. Precisa de >=2 meses de scope='client_mrr'.
export function mrrMovements(clientMrrRows, fromMonth, toMonth) {
  const at = (m) => { const map = {}; for (const r of clientMrrRows) if (r.snapshot_date === m) map[r.period] = r.value || 0; return map }
  const a = at(fromMonth), b = at(toMonth)
  if (!Object.keys(a).length || !Object.keys(b).length) return null
  let base = 0, expansion = 0, contraction = 0, churned = 0, novo = 0, reativacao = 0
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] || 0, y = b[id] || 0
    if (x > 0) base += x
    if (x > 0 && y > 0) { if (y > x) expansion += y - x; else if (y < x) contraction += x - y }
    else if (x > 0 && !y) churned += x
    else if (!x && y > 0) novo += y      // sem histórico anterior aqui não separamos novo de reativação
  }
  return {
    fromMonth, toMonth, base, expansion, contraction, churned, novo, reativacao,
    grr: base ? (base - contraction - churned) / base : null,
    nrr: base ? (base + expansion - contraction - churned) / base : null,
  }
}
export function mrrSnapshotMonths(clientMrrRows) {
  return [...new Set((clientMrrRows || []).map((r) => r.snapshot_date))].sort()
}

// ---- Qualidade / churn --------------------------------------------------
export function qualidade(clients, range) {
  const asOf = D(range.to + 'T23:59:59Z') || new Date()
  const activeStart = clients.filter((c) => { const s = day(wonDate(c)); if (!s || s >= range.from) return false; return !c.cancelation_date || day(c.cancelation_date) >= range.from })
  // FIX (auditoria A1): numerador ⊆ denominador — só quem estava ativo no início E cancelou no período.
  const churned = activeStart.filter((c) => inRange(c.cancelation_date, range))
  const churnRate = activeStart.length ? churned.length / activeStart.length : null
  // FIX (revisão métricas): o churn ACUMULADO do período depende do tamanho da janela (mesmo
  // erro do lifetime) — 7 meses dá ~44%, 1 mês ~10%, e nenhum é comparável a benchmark mensal.
  // Normaliza para uma taxa MENSAL equivalente (hazard constante) → comparável entre janelas.
  const nMonths = Math.max(1, monthsBetweenYm(range.from.slice(0, 7), range.to.slice(0, 7)) + 1) // p/ o rótulo humano
  const wMonths = windowMonths(range)                                                             // p/ a MATEMÁTICA (por dias)
  const churnMonthly = churnRate != null && churnRate < 1 ? 1 - Math.pow(1 - churnRate, 1 / wMonths) : churnRate
  return { churnRate, churnMonthly, nMonths, churned: churned.length, churnDen: activeStart.length, lifetime: programLifetime(clients, asOf) }
}

// ---- Mix de Tier (reutilizável p/ 3 populações) -------------------------
export function tierMix(items) {
  const t = { 1: 0, 2: 0, 3: 0, 4: 0, '?': 0 }
  for (const x of items) t[[1, 2, 3, 4].includes(x.tier) ? x.tier : '?']++
  return t
}
export const activeClients = (clients, range) => clients.filter((c) => activeAsOf(c, range.to))

// ---- Saúde do programa --------------------------------------------------
export function saudePrograma(ambassadors, referrers) {
  // TRÊS blocos que reconciliam (decisão do Lucas — clareza cadastrado/ativo/indicou):
  //  1) ROSTER formal do Pipedrive (funil 45): no funil / ativos / em processo / com fixo
  //  2) Quem REALMENTE indica (referrers programa=embaixador): total / dos ativos / sem cadastro
  //  3) Quem GERA cliente pagante: total / dos ativos / sem cadastro
  const ambById = Object.fromEntries(ambassadors.map((a) => [a.pd_deal_id, a]))
  const ativos = ambassadors.filter((a) => a.is_ativado)
  const comFixo = ativos.filter((a) => (a.fixo_mensal || 0) > 0)   // fixo só conta p/ ativos (Lucas)
  const fixoTotal = comFixo.reduce((s, a) => s + (a.fixo_mensal || 0), 0)
  const emb = referrers.filter((r) => r.programa === 'embaixador')
  const withCli = (arr) => arr.filter((r) => (r.n_clients || 0) > 0)
  const cadastrados = emb.filter((r) => r.registered)              // indicaram E estão no funil
  const semCad = emb.filter((r) => !r.registered)                  // indicaram sem estar no funil
  const isAtivoRef = (r) => !!(r.pd_ambassador_id && ambById[r.pd_ambassador_id]?.is_ativado)
  const ativosQueIndicaram = cadastrados.filter(isAtivoRef)
  return {
    // 1) roster
    noFunil: ambassadors.length,                          // 29 (todos os estágios)
    ativos: ativos.length,                                // 23 (estágio "Ativados")
    emProcesso: ambassadors.length - ativos.length,       // 6 (demo/negociação/onboarding)
    comFixo: comFixo.length,                              // 19 (ativos com fixo>0)
    fixoTotal,                                            // R$/mês somado
    // 2) quem indica
    totalQueIndicaram: emb.length,                        // 31
    ativosQueIndicaram: ativosQueIndicaram.length,        // 12
    cadastradosQueIndicaram: cadastrados.length,          // 13
    semCadastroQueIndicaram: semCad.length,               // 18
    // 3) quem gera cliente pagante
    queGeraramCliente: withCli(emb).length,               // 20
    ativosQueGeraramCliente: withCli(ativosQueIndicaram).length, // 6
    semCadastroQueGeraramCliente: withCli(semCad).length, // 13
    // taxas (denominador = ATIVOS, a base que importa)
    taxaIndicamAtivos: ativos.length ? ativosQueIndicaram.length / ativos.length : null,
    taxaConversaoIndicadores: emb.length ? withCli(emb).length / emb.length : null,
  }
}

// ---- Por programa -------------------------------------------------------
export function byPrograma(clients, leads, range) {
  const progs = {}
  const g = (p) => (progs[p] ||= { programa: p, refs: new Set(), leads: 0, ganhos: 0, clientesAtivos: 0, mrrAtivo: 0 })
  for (const l of leads) { const o = g(l._programa); o.refs.add(l.referrer_key); if (inRange(l.lead_date, range)) o.leads++ }
  for (const c of clients) {
    const o = g(c._programa); o.refs.add(c.referrer_key)
    if (inRange(wonDate(c), range)) o.ganhos++
    if (activeAsOf(c, range.to)) { o.clientesAtivos++; o.mrrAtivo += c.cmv || 0 }
  }
  return Object.values(progs).map((o) => ({ ...o, referenciadores: o.refs.size, taxaConversao: o.leads ? o.ganhos / o.leads : null })).sort((a, b) => b.mrrAtivo - a.mrrAtivo)
}

// ---- Concentração de risco (auditoria A3) -------------------------------
// Dependência de poucos embaixadores é o maior risco do programa. Share do MRR ativo
// por referenciador: top-1, top-3, HHI (0-1) e nº que responde por 80%.
export function concentracao(clients, range, referrers) {
  const nameOf = Object.fromEntries((referrers || []).map((r) => [r.referrer_key, r.name]))
  const byRef = {}
  for (const c of clients.filter((c) => activeAsOf(c, range.to))) byRef[c.referrer_key] = (byRef[c.referrer_key] || 0) + (c.cmv || 0)
  const vals = Object.entries(byRef).map(([k, v]) => ({ key: k, name: nameOf[k] || k, mrr: v })).sort((a, b) => b.mrr - a.mrr)
  const total = vals.reduce((s, x) => s + x.mrr, 0)
  const share = (n) => (total ? vals.slice(0, n).reduce((s, x) => s + x.mrr, 0) / total : 0)
  const hhi = total ? vals.reduce((s, x) => s + Math.pow(x.mrr / total, 2), 0) : 0
  let acc = 0, n80 = 0
  for (const x of vals) { acc += x.mrr; n80++; if (acc >= 0.8 * total) break }
  return {
    total, nRef: vals.length, top1: share(1), top3: share(3), top3mrr: vals.slice(0, 3).reduce((s, x) => s + x.mrr, 0), hhi, n80,
    top: vals.slice(0, 8).map((x) => ({ key: x.key, name: x.name, mrr: x.mrr, share: total ? x.mrr / total : 0 })),
  }
}

// Investimento em FIXO (vida toda) de um embaixador Ativado: fixo × meses desde o piso jan/2026
// (nunca antes da criação). Usado no investimentoTotal das linhas normais E nas de fixo órfão —
// uma fonte única, para as duas nunca divergirem.
function fixoInvest(amb, asOf) {
  if (!amb || !amb.is_ativado || !(amb.fixo_mensal > 0)) return 0
  const start = amb.data_criacao && amb.data_criacao > FLOOR_DATE ? amb.data_criacao : FLOOR_DATE
  return amb.fixo_mensal * monthsSince(start, asOf)
}

// ---- Eficiência por embaixador: COHORT + CAC + CAC Payback --------------
export function eficienciaCohort(clients, ambassadors, referrers, leadsByRef, range, asOf, orphanFixo = false) {
  const ambById = Object.fromEntries(ambassadors.map((a) => [a.pd_deal_id, a]))
  const asOfDay = asOf.toISOString().slice(0, 10)
  const monthsInRange = Math.max(1, monthsBetweenYm(range.from.slice(0, 7), range.to.slice(0, 7)) + 1)
  // Vida p/ o LTV: CURVA de retenção com desconto (não 1/churn). O churn é front-loaded, então
  // 1/churn superestima; a curva é o método correto p/ decisão de orçamento (LTV/CAC).
  const lifetime = curveLifetime(clients, asOf) ?? programLifetime(clients, asOf)
  const byRef = {}
  for (const c of clients) (byRef[c.referrer_key] ||= []).push(c)
  const rows = []
  const attributedAmb = new Set()   // deals cujo fixo JÁ foi mostrado numa linha de referrer
  for (const r of referrers) {
    // TODOS os indicadores do programa aparecem (decisão do Lucas), inclusive quem ainda não gerou
    // cliente. O caller passa os referrers já escopados por programa (embaixador/parceiro/todos).
    const cls = byRef[r.referrer_key] || []
    const registered = !!r.registered
    const amb = registered && r.pd_ambassador_id ? ambById[r.pd_ambassador_id] : null
    const fixoMensal = (amb && amb.is_ativado) ? (amb.fixo_mensal || 0) : 0   // fixo SÓ p/ Ativados (Lucas)
    // lifetime (vida toda)
    let comissaoTot = 0, receitaTot = 0, mrrAtivo = 0
    for (const c of cls) {
      const m = monthsActive(c, asOf)
      comissaoTot += (c.cmv || 0) * Math.min(m, 3)          // comissão realizada
      receitaTot += (c.cmv || 0) * m
      if (activeAsOf(c, asOfDay)) mrrAtivo += c.cmv || 0
    }
    // Investimento em fixo (vida toda) — helper compartilhado com as linhas de fixo órfão.
    if (fixoMensal) attributedAmb.add(amb.pd_deal_id)   // este deal já teve o fixo mostrado aqui
    const investimentoTotal = fixoInvest(amb, asOf) + comissaoTot
    // Piso do fixo p/ o CAC do período (respeita jan/2026 e a criação do embaixador).
    const fixoStart = amb && amb.data_criacao && amb.data_criacao > FLOOR_DATE ? amb.data_criacao : FLOOR_DATE
    // Fixo DO PERÍODO: só os meses do range em que o embaixador já existia (a partir de fixoStart,
    // que já respeita o piso jan/2026). Antes usava monthsInRange cheio, inflando o CAC de quem
    // entrou no meio do período — contradizia o investimentoTotal e o custo do topo. (FIX B1)
    const effStartYm = fixoStart.slice(0, 7) > range.from.slice(0, 7) ? fixoStart.slice(0, 7) : range.from.slice(0, 7)
    const fixoMesesRange = fixoMensal && effStartYm <= range.to.slice(0, 7) ? monthsBetweenYm(effStartYm, range.to.slice(0, 7)) + 1 : 0
    // cohort do período (clientes adquiridos no range)
    const cohort = cls.filter((c) => inRange(wonDate(c), range))
    const newCustomers = cohort.length
    let cac = null, ltvCac = null, payback = null, arpaCohort = null
    if (newCustomers) {
      // FIX (auditoria): CAC usa comissão COMPROMETIDA (3 meses), não a acumulada até hoje.
      const comissaoCohort = cohort.reduce((s, c) => s + (c.cmv || 0) * 3, 0)
      cac = (comissaoCohort + fixoMensal * fixoMesesRange) / newCustomers
      arpaCohort = cohort.reduce((s, c) => s + (c.cmv || 0), 0) / newCustomers
      // FIX (auditoria C2): LTV e payback de CONTRIBUIÇÃO (margem bruta), não receita bruta.
      const arpaMargem = arpaCohort * GROSS_MARGIN
      if (lifetime != null && cac > 0) ltvCac = (arpaMargem * lifetime) / cac
      payback = arpaMargem > 0 ? cac / arpaMargem : null
    }
    const nLeads = leadsByRef[r.referrer_key] || 0
    rows.push({
      key: r.referrer_key, email: r.email || r.referrer_key, name: r.name, registered, leads: nLeads, newCustomers,
      taxaConversao: nLeads ? newCustomers / nLeads : null, cac, ltvCac, payback, mrrAtivo,
      investimentoTotal, receita: receitaTot, net: receitaTot * GROSS_MARGIN - investimentoTotal,
    })
  }
  // Fixo ÓRFÃO: embaixadores Ativados que PAGAM fixo mas cujo deal do Pipedrive não casou com
  // nenhum referenciador do Customer.io (e-mail/nome diferentes, ou nunca indicaram). Sem isto o
  // fixo deles some da atribuição por indicador (ex.: Peter/EiNerd, R$18k, aparecia zerado) — mas
  // continua no custo/break-even total. Entram como linha própria (nome do Pipedrive), com o
  // investimento REAL e 0 clientes: é o pior ROI do programa, que estava escondido.
  if (orphanFixo) {
    // Órfão = Ativado com fixo cujo deal NÃO teve o fixo atribuído em nenhuma linha acima
    // (attributedAmb é exatamente o complemento do que foi mostrado — sem omitir nem duplicar).
    for (const a of ambassadors) {
      if (!a.is_ativado || !(a.fixo_mensal > 0) || attributedAmb.has(a.pd_deal_id)) continue
      const invest = fixoInvest(a, asOf)
      if (invest <= 0) continue   // ainda sem meses de fixo (ex.: entrou agora) — não polui a tabela
      rows.push({
        key: 'amb:' + a.pd_deal_id, email: a.email || a.name || ('deal ' + a.pd_deal_id), name: a.name,
        registered: true, leads: 0, newCustomers: 0, taxaConversao: null,
        cac: null, ltvCac: null, payback: null, mrrAtivo: 0,
        investimentoTotal: invest, receita: 0, net: -invest, orphan: true,
      })
    }
  }
  const totMrr = rows.reduce((s, r) => s + r.mrrAtivo, 0)
  rows.forEach((r) => { r.mrrShare = totMrr ? r.mrrAtivo / totMrr : 0 })  // % do MRR do programa
  return rows.sort((a, b) => b.newCustomers - a.newCustomers || b.net - a.net)
}

// ---- Séries temporais (piso jan/2026) -----------------------------------
export function monthlySeries(clients, leads, ambassadors, fromYm, toYm) {
  const cl = clients.map((c) => ({ cmv: c.cmv || 0, start: ym(wonDate(c)), end: ym(c.cancelation_date) }))
  const ld = leads.map((l) => ({ lead: ym(l.lead_date) }))
  const amb = ambFixos(ambassadors)
  return monthRange(fromYm, toYm).map((M) => {
    const active = cl.filter((c) => c.start && c.start <= M && (!c.end || c.end > M))
    const newC = cl.filter((c) => c.start === M)
    const lostC = cl.filter((c) => c.end === M)
    const activeStart = cl.filter((c) => c.start && c.start < M && (!c.end || c.end >= M)).length
    // FIX (auditoria A1): churn = quem estava ativo no início do mês E cancelou nele (⊆ base).
    const lostFromBase = cl.filter((c) => c.start && c.start < M && c.end === M).length
    const commission = active.filter((c) => monthsBetweenYm(c.start, M) < 3).reduce((s, c) => s + c.cmv, 0)
    const fixo = amb.filter((a) => a.start && a.start <= M).reduce((s, a) => s + a.fixo, 0)
    return {
      month: M, mrr: Math.round(active.reduce((s, c) => s + c.cmv, 0)), ativos: active.length,
      newMrr: Math.round(newC.reduce((s, c) => s + c.cmv, 0)), lostMrr: -Math.round(lostC.reduce((s, c) => s + c.cmv, 0)),
      churn: activeStart ? +(100 * lostFromBase / activeStart).toFixed(1) : 0,
      leads: ld.filter((l) => l.lead === M).length, ganhos: newC.length,
      custo: Math.round(commission + fixo), cancellations: lostC.length,
    }
  })
}
export function mergeByIndex(primary, compare, keys) {
  return primary.map((p, i) => { const c = compare[i] || {}; const row = { ...p }; for (const k of keys) row[k + '_cmp'] = c[k]; return row })
}
// Curva acumulada (break-even do programa): receita − comissão − fixo, acumulado desde jan/2026.
export function cumulativeContribution(clients, ambassadors) {
  const cl = clients.map((c) => ({ cmv: c.cmv || 0, start: ym(wonDate(c)), end: ym(c.cancelation_date) }))
  const amb = ambFixos(ambassadors)
  const now = new Date()
  const max = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  let cum = 0
  return monthRange(FLOOR_YM, max).map((M) => {
    const active = cl.filter((c) => c.start && c.start <= M && (!c.end || c.end > M))
    const revenue = active.reduce((s, c) => s + c.cmv, 0)
    const commission = active.filter((c) => monthsBetweenYm(c.start, M) < 3).reduce((s, c) => s + c.cmv, 0)
    const fixo = amb.filter((a) => a.start && a.start <= M).reduce((s, a) => s + a.fixo, 0)
    // FIX (auditoria C2): break-even sobre CONTRIBUIÇÃO (receita × margem) − comissão − fixo.
    cum += revenue * GROSS_MARGIN - commission - fixo
    return { month: M, net: Math.round(cum) }
  })
}
