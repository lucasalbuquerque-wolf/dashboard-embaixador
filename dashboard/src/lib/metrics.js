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
  // Regra (confirmada com Lucas): tem fixo QUEM tem o valor de fixo no Pipedrive (fixo_mensal>0).
  // Nem todo cadastrado tem fixo — os sem valor só ganham comissão pelos clientes.
  // Conta a partir do piso (jan/2026); a data de criação no funil não importa para o recorte.
  return (ambassadors || []).filter((a) => (a.fixo_mensal || 0) > 0)
    .map((a) => ({ fixo: a.fixo_mensal, start: ym(a.data_criacao) || FLOOR_YM }))
}
function monthlyCost(clients, ambassadors, M) {
  const commission = clients.filter((c) => { const s = ym(wonDate(c)), e = ym(c.cancelation_date); return s && s <= M && (!e || e > M) && monthsBetweenYm(s, M) < 3 })
    .reduce((s, c) => s + (c.cmv || 0), 0)
  const fixo = ambFixos(ambassadors).filter((a) => a.start && a.start <= M).reduce((s, a) => s + a.fixo, 0)
  return commission + fixo
}
function periodCost(clients, ambassadors, range) {
  return monthRange(range.from.slice(0, 7), range.to.slice(0, 7)).reduce((s, M) => s + monthlyCost(clients, ambassadors, M), 0)
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
  return {
    leads: nLeads, ganhos: ganhosC.length, custo,
    cancelados: cancelC.length, newMrr,
    taxaConversao: nLeads ? ganhosC.length / nLeads : null,
    clientesAtivos: activeC.length, mrrAtivo, arpa: activeC.length ? mrrAtivo / activeC.length : 0,
    custoPorLead: nLeads ? custo / nLeads : null,          // custo do programa ÷ leads
    custoPorCliente: ganhosC.length ? custo / ganhosC.length : null, // ÷ novos clientes
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
  return {
    mrrAtivo, mrrLost, netGain: newMrr - mrrLost,
    mrrGrowth: mrrFrom ? (mrrAtivo - mrrFrom) / mrrFrom : null,
    grossMrrChurn: mrrFrom ? mrrLostBase / mrrFrom : null,   // % da receita da base que sangrou
    grr: mrrFrom ? (mrrFrom - mrrLostBase) / mrrFrom : null, // retenção bruta de receita (<=100%)
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
  return { churnRate: activeStart.length ? churned.length / activeStart.length : null, churned: churned.length, churnDen: activeStart.length, lifetime: programLifetime(clients, asOf) }
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
  // Dois universos distintos — manter explícitos para que os números reconciliem:
  //  • ambassadors = cadastrados no Pipedrive (matriculados no programa)
  //  • referrers programa=embaixador = quem de fato indicou ≥1 lead (cadastrado ou não)
  const emb = referrers.filter((r) => r.programa === 'embaixador')
  const comCliente = (arr) => arr.filter((r) => (r.n_clients || 0) > 0).length
  const cadastradosQueIndicaram = emb.filter((r) => r.registered)   // ⊆ ambassadors
  const semCad = emb.filter((r) => !r.registered)                  // disjunto de ambassadors
  const nCad = ambassadors.length
  return {
    // universo 1 — cadastrados (tabela ambassadors)
    cadastradosTotal: nCad,                                          // ex.: 26
    embaixadoresAtivos: ambassadors.filter((a) => a.is_ativado).length, // 20 (estágio Ativados)
    cadastradosQueIndicaram: cadastradosQueIndicaram.length,         // 13
    cadastradosComCliente: comCliente(cadastradosQueIndicaram),      // 5
    // universo 2 — quem indicou (tabela referrers, programa=embaixador)
    indicadoresSemCadastro: semCad.length,                          // 17
    totalQueIndicaram: emb.length,                                  // 30 = 13 + 17
    indicadoresComCliente: comCliente(emb),                         // 17
    // universo 3 — todas as pessoas do programa (cadastrados ∪ sem cadastro que indicaram)
    totalPessoas: nCad + semCad.length,                             // 43 = 26 + 17
    // taxas — cada uma 100% consistente com seu denominador
    taxaIndicacaoCadastrados: nCad ? cadastradosQueIndicaram.length / nCad : null, // 13/26
    taxaConversaoCadastrados: nCad ? comCliente(cadastradosQueIndicaram) / nCad : null, // 5/26
    taxaConversaoIndicadores: emb.length ? comCliente(emb) / emb.length : null,    // 17/30
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
  return { total, nRef: vals.length, top1: share(1), top3: share(3), hhi, n80, top: vals.slice(0, 3) }
}

// ---- Eficiência por embaixador: COHORT + CAC + CAC Payback --------------
export function eficienciaCohort(clients, ambassadors, referrers, leadsByRef, range, asOf) {
  const ambById = Object.fromEntries(ambassadors.map((a) => [a.pd_deal_id, a]))
  const asOfDay = asOf.toISOString().slice(0, 10)
  const monthsInRange = Math.max(1, monthsBetweenYm(range.from.slice(0, 7), range.to.slice(0, 7)) + 1)
  // FIX (auditoria A2): lifetime do programa (1/churn), não por embaixador — sem viés nem null.
  const lifetime = programLifetime(clients, asOf)
  const byRef = {}
  for (const c of clients) (byRef[c.referrer_key] ||= []).push(c)
  const rows = []
  for (const r of referrers) {
    if (r.programa !== 'embaixador') continue
    const cls = byRef[r.referrer_key] || []
    if (!cls.length) continue
    const registered = !!r.registered
    const amb = registered && r.pd_ambassador_id ? ambById[r.pd_ambassador_id] : null
    const fixoMensal = amb ? (amb.fixo_mensal || 0) : 0   // fixo = quem tem valor no Pipedrive
    // lifetime (vida toda)
    let comissaoTot = 0, receitaTot = 0, mrrAtivo = 0
    for (const c of cls) {
      const m = monthsActive(c, asOf)
      comissaoTot += (c.cmv || 0) * Math.min(m, 3)          // comissão realizada
      receitaTot += (c.cmv || 0) * m
      if (activeAsOf(c, asOfDay)) mrrAtivo += c.cmv || 0
    }
    // FIX (auditoria A8/C1): fixo conta com o mesmo fallback de data (FLOOR_DATE) do custo.
    const fixoMeses = fixoMensal ? monthsSince((amb && amb.data_criacao) || FLOOR_DATE, asOf) : 0
    const investimentoTotal = fixoMensal * fixoMeses + comissaoTot
    // cohort do período (clientes adquiridos no range)
    const cohort = cls.filter((c) => inRange(wonDate(c), range))
    const newCustomers = cohort.length
    let cac = null, ltvCac = null, payback = null, arpaCohort = null
    if (newCustomers) {
      // FIX (auditoria): CAC usa comissão COMPROMETIDA (3 meses), não a acumulada até hoje.
      const comissaoCohort = cohort.reduce((s, c) => s + (c.cmv || 0) * 3, 0)
      cac = (comissaoCohort + fixoMensal * monthsInRange) / newCustomers
      arpaCohort = cohort.reduce((s, c) => s + (c.cmv || 0), 0) / newCustomers
      // FIX (auditoria C2): LTV e payback de CONTRIBUIÇÃO (margem bruta), não receita bruta.
      const arpaMargem = arpaCohort * GROSS_MARGIN
      if (lifetime != null && cac > 0) ltvCac = (arpaMargem * lifetime) / cac
      payback = arpaMargem > 0 ? cac / arpaMargem : null
    }
    const nLeads = leadsByRef[r.referrer_key] || 0
    rows.push({
      key: r.referrer_key, name: r.name, registered, leads: nLeads, newCustomers,
      taxaConversao: nLeads ? newCustomers / nLeads : null, cac, ltvCac, payback, mrrAtivo,
      investimentoTotal, receita: receitaTot, net: receitaTot * GROSS_MARGIN - investimentoTotal,
    })
  }
  const totMrr = rows.reduce((s, r) => s + r.mrrAtivo, 0)
  rows.forEach((r) => { r.mrrShare = totMrr ? r.mrrAtivo / totMrr : 0 })  // % do MRR do programa
  return rows.sort((a, b) => b.newCustomers - a.newCustomers || b.net - a.net)
}

// ---- Séries temporais (piso 2025) ---------------------------------------
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
// Curva acumulada (break-even do programa): receita − comissão − fixo, acumulado desde 2025.
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
