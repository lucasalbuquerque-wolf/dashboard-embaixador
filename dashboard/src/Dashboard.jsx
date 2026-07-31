import { useEffect, useMemo, useState, Fragment } from 'react'
import { supabase } from './supabase'
import DateRangePicker from './DateRangePicker'
import Assistant from './Assistant'
import FaqModal from './Faq'
import { buildContext } from './lib/ai'
import {
  money, pct, num1, annotate, annotateLeads, scopeClients, scopeLeads, leadsByReferrer,
  computeKpis, mrrSection, qualidade, saudePrograma, byPrograma, eficienciaCohort,
  tierMix, activeClients, monthlySeries, cumulativeContribution, mergeByIndex, inRange, wonDate,
  concentracao, GROSS_MARGIN, retentionCurve, mrrMovements, mrrSnapshotMonths,
  cohortRetentionMatrix, RET_OFFSETS, curveLifetime, programLifetime, lifetimeSummary,
} from './lib/metrics'
import {
  ResponsiveContainer, ComposedChart, AreaChart, LineChart, Area, Line, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'

const pad = (n) => String(n).padStart(2, '0')
const today = new Date()
const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
const asOf = today
const CMARGIN = { top: 6, right: 12, bottom: 0, left: 0 }
const kfmt = (x) => (Math.abs(x) >= 1000 ? 'R$' + Math.round(x / 1000) + 'k' : 'R$' + x)
const numfmt = (n) => Math.round(n || 0).toLocaleString('pt-BR')

const F0 = {
  range: { from: `${today.getFullYear()}-01-01`, to: todayISO },
  compareOn: false, compareRange: null, programa: 'embaixador', registered: 'todos', tier: 'todos',
}
const TOP = [
  { key: 'leads', kpiKey: 'leads', label: 'Leads', color: '#1A5CFF', up: true },
  { key: 'ganhos', kpiKey: 'ganhos', label: 'New Customers', color: '#12A97A', up: true },
  { key: 'custo', kpiKey: 'custo', label: 'Custo', color: '#FF552F', up: false, money: true },
  { key: 'cancellations', kpiKey: 'cancelados', label: 'Customer Cancellations', color: '#C77A16', up: false, note: 'Conta quem CANCELOU dentro de 2026 — inclui clientes adquiridos ANTES de 2026 (a maior parte), que faziam parte da base que pagava. É perda real do período. O recorte "2026" aqui é a janela do cancelamento, não a safra do cliente — a mesma base do Churn e do MRR Lost.' },
  { key: 'newMrr', kpiKey: 'newMrr', label: 'New MRR', color: '#8B5CF6', up: true, money: true },
]
const NORMK = ['leads', 'ganhos', 'custo', 'cancellations', 'newMrr']
const NAV = [
  ['assistente', 'Assistente', 'sparkle'], ['geral', 'Visão geral', 'squares-four'], ['mrr', 'MRR', 'currency-circle-dollar'],
  ['concentracao', 'Concentração', 'target'], ['eficiencia', 'Eficiência', 'gauge'], ['breakeven', 'Break-even', 'chart-line-up'],
  ['retencao', 'Retenção', 'wave-sine'], ['programa', 'Por programa', 'stack'], ['saude', 'Churn & saúde', 'heartbeat'],
  ['tier', 'Mix de Tier', 'buildings'],
]

async function fetchAll(table, cols, applyFilter) {
  const out = []; const size = 1000
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(cols)
    if (applyFilter) q = applyFilter(q)
    const { data, error } = await q.range(from, from + size - 1)
    if (error) throw error
    out.push(...data)
    if (!data || data.length < size) break
  }
  return out
}
function addNorm(series, keys) {
  const max = {}
  for (const k of keys) max[k] = Math.max(1, ...series.map((s) => Math.abs(s[k] || 0)), ...series.map((s) => Math.abs(s[k + '_cmp'] || 0)))
  return series.map((s) => { const r = { ...s }; for (const k of keys) { r[k + '_n'] = (s[k] || 0) / max[k]; if (s[k + '_cmp'] != null) r[k + '_cmp_n'] = (s[k + '_cmp'] || 0) / max[k] } return r })
}

export default function Dashboard({ session }) {
  const [raw, setRaw] = useState(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState(F0)
  const [topSel, setTopSel] = useState(new Set(['leads', 'ganhos']))
  const [mrrMode, setMrrMode] = useState('newlost')
  const [tierPop, setTierPop] = useState('active')
  const [active, setActive] = useState('geral')
  const [showFaq, setShowFaq] = useState(false)

  useEffect(() => {
    if (!raw) return
    const obs = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (vis[0]) setActive(vis[0].target.id)
    }, { rootMargin: '-15% 0px -70% 0px' })
    document.querySelectorAll('section[id]').forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [raw])

  useEffect(() => {
    const h = (e) => {
      const r = document.documentElement
      r.style.setProperty('--ptr-x', e.clientX)
      r.style.setProperty('--ptr-y', e.clientY)
    }
    window.addEventListener('pointermove', h)
    return () => window.removeEventListener('pointermove', h)
  }, [])

  useEffect(() => {
    (async () => {
      // FIX (auditoria A4): paginar os 3 — sem .range() o PostgREST corta em 1000 linhas (clients já em 670).
      let cli, refs, amb, leads = []
      try {
        [cli, refs, amb] = await Promise.all([fetchAll('clients', '*'), fetchAll('referrers', '*'), fetchAll('ambassadors', '*')])
      } catch (e) { setErr(e.message); return }
      try { leads = await fetchAll('leads', 'referrer_key,programa,lead_date,tier') } catch { /* leads vazios */ }
      let pdDaily = [], mrrSnap = []
      try {
        const s = await supabase.from('snapshots').select('snapshot_date,period,value').eq('scope', 'pipedrive').eq('metric', 'negocios_embaixador')
        pdDaily = s.data || []
      } catch { /* sem dados de Pipedrive */ }
      try {
        mrrSnap = await fetchAll('snapshots', 'snapshot_date,period,value', (q) => q.eq('scope', 'client_mrr'))
      } catch { /* sem snapshots de MRR ainda */ }
      // Escopo do dashboard (decisão do Lucas): só embaixador + parceiro. Remove interno/indefinido/franquia.
      const KEEP = new Set(['embaixador', 'parceiro'])
      const clientsF = annotate(cli, refs).filter((c) => KEEP.has(c._programa))
      const leadsF = annotateLeads(leads, refs).filter((l) => KEEP.has(l._programa))
      setRaw({ clients: clientsF, referrers: refs, ambassadors: amb, leads: leadsF, pdDaily, mrrSnap })
    })()
  }, [])

  const v = useMemo(() => {
    if (!raw) return null
    const sc = scopeClients(raw.clients, f), sl = scopeLeads(raw.leads || [], f)
    const range = f.range, cmp = f.compareOn && f.compareRange ? f.compareRange : null
    const A = raw.ambassadors, R = raw.referrers
    // FIX (reconciliação): o fixo é custo SÓ do programa embaixador (funil 45). Sob o filtro
    // 'parceiro' o fixo tem que ser 0 (parceiro não tem fixo); assim custo(emb)+custo(par)=custo(todos).
    const Acost = f.programa === 'parceiro' ? [] : A
    let series = monthlySeries(sc, sl, Acost, range.from.slice(0, 7), range.to.slice(0, 7))
    if (cmp) series = mergeByIndex(series, monthlySeries(sc, sl, Acost, cmp.from.slice(0, 7), cmp.to.slice(0, 7)), [...NORMK, 'mrr', 'lostMrr'])
    series = addNorm(series, NORMK)
    const allC = scopeClients(raw.clients, { ...f, programa: 'todos' }), allL = scopeLeads(raw.leads || [], { ...f, programa: 'todos' })
    // Eficiência: TODOS os indicadores do programa filtrado (embaixador/parceiro/ambos), mesmo sem cliente ainda.
    const efRefs = R.filter((r) => f.programa === 'todos' ? (r.programa === 'embaixador' || r.programa === 'parceiro') : r.programa === f.programa)
    // Funil de indicações (sempre programa embaixador — casa com o rótulo dos negócios no Pipedrive)
    const sumPd = (period) => (raw.pdDaily || []).filter((r) => r.period === period && r.snapshot_date >= range.from && r.snapshot_date <= range.to).reduce((s, r) => s + (r.value || 0), 0)
    const funnel = {
      leads: (raw.leads || []).filter((l) => l._programa === 'embaixador' && inRange(l.lead_date, range)).length,
      negocios: sumPd('created'),
      ganhos: raw.clients.filter((c) => c._programa === 'embaixador' && inRange(wonDate(c), range)).length,
      hasPd: (raw.pdDaily || []).length > 0,
    }
    // Mix de tier dos LEADS de cada indicador no período (para expandir a linha na Eficiência).
    const efTierMix = {}
    for (const l of sl) {
      if (!inRange(l.lead_date, range)) continue
      const t = [1, 2, 3, 4].includes(l.tier) ? l.tier : '?'
      ;(efTierMix[l.referrer_key] ||= { 1: 0, 2: 0, 3: 0, 4: 0, '?': 0 })[t]++
    }
    return {
      funnel, efTierMix,
      kpi: computeKpis(sc, sl, Acost, range), kpiCmp: cmp ? computeKpis(sc, sl, Acost, cmp) : null,
      mrr: mrrSection(sc, range), mrrCmp: cmp ? mrrSection(sc, cmp) : null,
      qual: qualidade(sc, range), sau: saudePrograma(A, R), conc: concentracao(sc, range, R),
      ret: retentionCurve(sc, asOf), retMatrix: cohortRetentionMatrix(sc, asOf),
      life: lifetimeSummary(sc, asOf),
      mrrMov: (() => { const ms = mrrSnapshotMonths(raw.mrrSnap || []); return ms.length >= 2 ? mrrMovements(raw.mrrSnap, ms[ms.length - 2], ms[ms.length - 1]) : null })(),
      snapMonths: mrrSnapshotMonths(raw.mrrSnap || []).length,
      ef: eficienciaCohort(sc, A, efRefs, leadsByReferrer(sl, range), range, asOf),
      prog: byPrograma(allC, allL, range), payback: cumulativeContribution(sc, Acost),
      series, compareOn: !!cmp,
      // Mix de Tier respeita programa/cadastro (mas ignora o filtro de Tier — senão vira 100% de um tier só).
      tierLeads: tierMix(scopeLeads(raw.leads || [], { ...f, tier: 'todos' }).filter((l) => inRange(l.lead_date, range))),
      tierActive: tierMix(activeClients(scopeClients(raw.clients, { ...f, tier: 'todos' }), range)),
    }
  }, [raw, f])

  const aiContext = useMemo(() => { try { return raw ? buildContext(raw) : '' } catch { return '' } }, [raw])

  if (err) return <div className="center err">Erro: {err}</div>
  if (!v) return <div className="center muted">Carregando dados…</div>
  const selKey = (key) => () => { const s = new Set(topSel); s.has(key) ? s.delete(key) : s.add(key); setTopSel(s) }
  const setSel = (key) => (e) => setF({ ...f, [key]: e.target.value })
  const curTier = tierPop === 'leads' ? v.tierLeads : v.tierActive
  const curTierTotal = [1, 2, 3, 4, '?'].reduce((s, k) => s + (curTier[k] || 0), 0)
  const curTierUnit = tierPop === 'active' ? 'clientes ativos' : 'leads'
  const shownTop = TOP.filter((m) => topSel.has(m.key))
  const indLabel = f.programa === 'parceiro' ? 'parceiros' : f.programa === 'todos' ? 'indicadores' : 'embaixadores'

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav>{NAV.map(([id, label, icon]) => (
          <a key={id} href={'#' + id} className={active === id ? 'active' : ''}><i className={'ph ph-' + icon} />{label}</a>
        ))}</nav>
        <div className="side-foot">
          <button className="faq-btn" onClick={() => setShowFaq(true)} title="Como o dashboard funciona — FAQ">?</button>
          <div>{session.user.email}<br /><a onClick={() => supabase.auth.signOut()}>sair</a></div>
        </div>
      </aside>
      <main className="main">

      <div className="page-head">
        <h1>{(NAV.find(([id]) => id === active) || [, 'Visão geral'])[1]}</h1>
        <div className="prog">Programa <b style={{ textTransform: 'capitalize' }}>{f.programa === 'todos' ? 'Todos' : f.programa}</b></div>
      </div>

      <div className="filters">
        <DateRangePicker value={{ range: f.range, compareOn: f.compareOn, compareRange: f.compareRange }} onChange={(val) => setF({ ...f, ...val })} />
        <Sel label="Programa" value={f.programa} onChange={setSel('programa')} opts={[['todos', 'Todos'], ['embaixador', 'Embaixador'], ['parceiro', 'Parceiro']]} />
        <Sel label="Cadastro" value={f.registered} onChange={setSel('registered')} opts={[['todos', 'Todos'], ['cadastrado', 'Cadastrado'], ['naocad', 'Não cadastrado']]} />
        <Sel label="Tier" value={f.tier} onChange={setSel('tier')} opts={[['todos', 'Todos'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} />
      </div>

      <div id="assistente" className="assistant-wrap">
        <Assistant context={aiContext} />
      </div>

      {/* Visão geral: cards clicáveis + gráfico interativo */}
      <section id="geral" className="card">
        <div className="metric-cards">
          {TOP.map((m) => (
            <button key={m.key} className={'metric-card' + (topSel.has(m.key) ? ' on' : '')} style={{ '--mc': m.color }} onClick={selKey(m.key)}>
              <div className="mc-l"><span className="mc-dot" style={{ background: m.color }} />{m.label}
                {m.note && <span className="info" tabIndex={0} aria-label={m.note} onClick={(e) => { e.stopPropagation(); e.preventDefault() }}><i className="ph ph-question" /><span className="info-tip">{m.note}</span></span>}
              </div>
              <div className="mc-v">{m.money ? money(v.kpi[m.kpiKey]) : numfmt(v.kpi[m.kpiKey])}</div>
              {v.kpiCmp && <Delta v={v.kpi[m.kpiKey]} cv={v.kpiCmp[m.kpiKey]} up={m.up} />}
            </button>
          ))}
        </div>
        <div className="small muted" style={{ margin: '2px 0 6px' }}>Escala relativa (índice 0–1, cada métrica ÷ seu próprio máximo) — passe o mouse para os valores reais. Cruzamentos entre linhas não têm significado de magnitude.</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={v.series} margin={CMARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,30,60,0.07)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={28} interval="preserveStartEnd" />
            <YAxis hide domain={[0, 1.05]} />
            <Tooltip content={<TopTip metrics={shownTop} />} />
            {shownTop.map((m) => <Line key={m.key} type="monotone" dataKey={m.key + '_n'} stroke={m.color} strokeWidth={2} dot={false} />)}
            {v.compareOn && shownTop.map((m) => <Line key={m.key + 'c'} type="monotone" dataKey={m.key + '_cmp_n'} stroke={m.color} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />)}
          </LineChart>
        </ResponsiveContainer>
        {f.programa !== 'parceiro' && <Funnel f={v.funnel} />}
        <div className="stats" style={{ marginTop: 12 }}>
          <Stat l="Custo por lead" v={v.kpi.custoPorLead != null ? money(v.kpi.custoPorLead) : '—'} sub="Quanto o programa gastou em FIXO para cada indicação que entrou no período. Só o fixo entra aqui — a comissão só existe quando o lead vira cliente (e aí vira custo de cliente, não de lead). Serve para comparar o canal de indicação com outros canais de aquisição." delta={v.kpiCmp && <Delta v={v.kpi.custoPorLead} cv={v.kpiCmp.custoPorLead} up={false} />} />
          <Stat l="Custo por cliente novo" v={v.kpi.custoPorCliente != null ? money(v.kpi.custoPorCliente) : '—'} sub="Quanto o programa gastou para cada cliente novo que fechou no período. É o custo de aquisição por cliente, pelo canal de indicação." delta={v.kpiCmp && <Delta v={v.kpi.custoPorCliente} cv={v.kpiCmp.custoPorCliente} up={false} />} />
        </div>
      </section>

      {/* MRR */}
      <Section id="mrr" title="MRR">
        <div className="stats">
          <Stat l="MRR ativo" v={money(v.mrr.mrrAtivo)} sub="Receita recorrente mensal da base ativa hoje: a soma do valor de contrato de todos os clientes ativos do programa. É o 'estoque' de receita. INCLUI clientes de safras anteriores a 2026 que ainda pagam — o recorte '2026' é a janela de análise, não restringe a base a quem entrou em 2026 (senão esconderia receita real no caixa)." delta={v.mrrCmp && <Delta v={v.mrr.mrrAtivo} cv={v.mrrCmp.mrrAtivo} up />} />
          <Stat l="ARPA (ticket médio)" v={money(v.kpi.arpa)} sub="Ticket médio: quanto cada cliente ativo paga por mês, em média. É a receita recorrente (MRR) dividida pelo número de clientes ativos. A base ativa inclui clientes adquiridos antes de 2026 que ainda pagam." delta={v.kpiCmp && <Delta v={v.kpi.arpa} cv={v.kpiCmp.arpa} up />} />
          <Stat l="MRR Lost" v={money(v.mrr.mrrLost)} bad sub={`Receita recorrente que saiu no período — soma do contrato de TODOS que cancelaram (fluxo total, mesma base do card "Customer Cancellations"). Destes, ${money(v.mrr.mrrLostBase)} vinham da base que já existia no início; o resto (${money(v.mrr.mrrLost - v.mrr.mrrLostBase)}) são clientes que entraram E saíram dentro do período. O GRR usa só a parte da base. INCLUI clientes adquiridos antes de 2026 que cancelaram agora — o "2026" é a janela do cancelamento, não a safra do cliente.`} delta={v.mrrCmp && <Delta v={v.mrr.mrrLost} cv={v.mrrCmp.mrrLost} up={false} />} />
          <Stat l="GRR mensal (equiv.)" v={pct(v.mrr.grrMonthly)} good={v.mrr.grrMonthly >= 0.85} bad={v.mrr.grrMonthly != null && v.mrr.grrMonthly < 0.85} sub={`De tudo que a base já pagava, quanto você retém por mês (sem contar vendas novas) — normalizado para taxa MENSAL, comparável com o benchmark (saudável acima de 85%). No período inteiro (${v.qual.nMonths} ${v.qual.nMonths === 1 ? 'mês' : 'meses'}) o GRR acumulado foi ${pct(v.mrr.grr)} e a receita da base sangrou ${pct(v.mrr.grossMrrChurn)} — mas esse acumulado depende do tamanho da janela, por isso mostramos o mensal. A base é a receita que já existia no início do período (clientes majoritariamente adquiridos antes de 2026).`} />
          <Stat l="MRR Growth" v={pct(v.mrr.mrrGrowth)} good={v.mrr.mrrGrowth >= 0} bad={v.mrr.mrrGrowth < 0} sub="Crescimento % da receita recorrente no período: quanto o MRR ativo variou do início ao fim (inclui vendas novas e cancelamentos). A base do início e a de hoje incluem clientes adquiridos antes de 2026." />
          <Stat l="Net Gain MRR" v={money(v.mrr.netGain)} good={v.mrr.netGain >= 0} bad={v.mrr.netGain < 0} sub="Ganho líquido de receita no período: receita nova que entrou (New MRR) menos a que saiu por cancelamento (MRR Lost). O MRR Lost inclui clientes adquiridos antes de 2026 que cancelaram no período (perda real de caixa)." delta={v.mrrCmp && <Delta v={v.mrr.netGain} cv={v.mrrCmp.netGain} up />} />
          <Stat l="NRR (retenção líquida)" v={v.mrrMov ? pct(v.mrrMov.nrr) : '—'} good={v.mrrMov && v.mrrMov.nrr >= 1} bad={v.mrrMov && v.mrrMov.nrr < 1}
            sub={v.mrrMov ? `De tudo que a base pagava, quanto sobrou considerando upgrades e cancelamentos. Expansão ${money(v.mrrMov.expansion)}, contração ${money(v.mrrMov.contraction)}. Acima de 100% = a base cresce sozinha, sem vendas novas.` : `Mostra se a base de clientes cresce ou encolhe sozinha (sem contar vendas novas). Precisa de 2 fotos mensais de MRR para comparar — só temos ${v.snapMonths} até agora. Acende no próximo sync em um mês diferente.`} />
        </div>
        <div className="chart-toggle">
          <button className={mrrMode === 'newlost' ? 'on' : ''} onClick={() => setMrrMode('newlost')}>New vs Lost</button>
          <button className={mrrMode === 'mrr' ? 'on' : ''} onClick={() => setMrrMode('mrr')}>MRR ativo</button>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          {mrrMode === 'newlost' ? (
            <ComposedChart data={v.series} margin={CMARGIN}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,30,60,0.07)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={28} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={kfmt} />
              <Tooltip formatter={(x) => money(Math.abs(x))} />
              <ReferenceLine y={0} stroke="rgba(20,30,60,0.12)" /><Bar dataKey="newMrr" fill="#12A97A" radius={[3, 3, 0, 0]} /><Bar dataKey="lostMrr" fill="#FF552F" radius={[0, 0, 3, 3]} />
            </ComposedChart>
          ) : (
            <AreaChart data={v.series} margin={CMARGIN}>
              <defs><linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1A5CFF" stopOpacity={0.3} /><stop offset="100%" stopColor="#1A5CFF" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,30,60,0.07)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={28} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={kfmt} />
              <Tooltip formatter={(x) => money(x)} />
              <Area type="monotone" dataKey="mrr" stroke="#1A5CFF" strokeWidth={2} fill="url(#gm)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </Section>

      {/* Concentração de risco */}
      <Section id="concentracao" title="Concentração de risco" sub={`Quanto do MRR do programa depende de poucos ${indLabel}. Se os maiores saírem, quanto da receita cai junto. Quanto mais concentrado no topo, mais frágil o programa. É uma FOTO da base ativa no fim do período — por isso não muda entre "últimos 7/30/90 dias" (todos terminam hoje, mesma foto, igual "MRR ativo"); só muda quando a data final muda (ex.: "mês passado").`}>
        {v.conc.top[0] && (
          <p className="conc-summary">
            Os <b>3 maiores</b> {indLabel} concentram <b className={v.conc.top3 > 0.6 ? 'neg' : ''}>{pct(v.conc.top3)}</b> do MRR ativo
            ({money(v.conc.top3mrr)} de {money(v.conc.total)}). Sozinho, <b>{short(v.conc.top[0].name)}</b> responde por <b className={v.conc.top1 > 0.3 ? 'neg' : ''}>{pct(v.conc.top1)}</b>.
            {' '}Apenas <b>{v.conc.n80}</b> dos {v.conc.nRef} {indLabel} ativos já fazem 80% da receita.
          </p>
        )}
        <div className="conc-list">
          {v.conc.top.map((x, i) => (
            <div className="conc-row" key={x.key}>
              <span className="conc-rank">{i + 1}</span>
              <span className="conc-name">{short(x.name) || x.key}</span>
              <div className="conc-bar"><div style={{ width: (v.conc.top[0].share ? 100 * x.share / v.conc.top[0].share : 0).toFixed(0) + '%', background: x.share > 0.3 ? 'var(--err)' : 'var(--brand)' }} /></div>
              <span className="conc-val">{money(x.mrr)}</span>
              <span className="conc-pct">{pct(x.share)}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Eficiência por embaixador (cohort + CAC) */}
      <Section id="eficiencia" title={f.programa === 'todos' ? 'Eficiência por indicador' : `Eficiência por ${f.programa}`} sub={`Quanto cada indicador traz e quanto custa — uma linha por pessoa (pelo e-mail; passe o mouse para ver o nome). No período escolhido: quantos clientes trouxe, quanto custou trazer cada um (CAC) e em quantos meses o cliente devolve esse custo (CAC Payback — o número que mais importa para decidir). Aparecem todos, inclusive quem ainda não trouxe cliente. O que cada coluna significa está no FAQ (botão "?").`}>
        <EficienciaTable rows={v.ef} tiers={v.efTierMix} />
      </Section>

      {/* Break-even do programa */}
      <Section id="breakeven" title="Break-even do programa" sub={`Curva acumulada desde jan/2026 de ${GROSS_MARGIN < 1 ? `contribuição (receita × ${Math.round(GROSS_MARGIN * 100)}% de margem)` : 'receita'} − comissão − fixo. Enquanto está negativa, o programa ainda não se pagou; quando cruza o zero, se pagou.`}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={v.payback} margin={CMARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,30,60,0.07)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={28} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={kfmt} />
            <Tooltip formatter={(x) => money(x)} />
            <ReferenceLine y={0} stroke="#FF552F" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="net" stroke="#1A5CFF" strokeWidth={2} fill="#1A5CFF" fillOpacity={0.1} />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* Retenção (curva de sobrevivência) */}
      <Section id="retencao" title="Retenção (curva de sobrevivência)" sub="Dos clientes que já tiveram tempo de chegar ao mês N depois de virarem cliente, quantos % continuam ativos. Mostra a forma da retenção — em que mês os clientes começam a cancelar. Esta CURVA usa TODA a base pelo tempo de vida real de cada cliente (é o melhor estimador para o lifetime/LTV, com mais dados na cauda). O heatmap por safra logo abaixo é OUTRA visão — só cohorts de 2026 — por isso os dois números podem diferir para o mesmo mês, especialmente com poucas amostras.">
        {(() => {
          const s = (k) => (v.ret.find((p) => p.offset === k) || {}).pct
          const s3 = s(3), s6 = s(6)
          if (s3 == null || s6 == null) return null
          const hEarly = 1 - Math.pow(s3, 1 / 3), hMid = 1 - Math.pow(s6 / s3, 1 / 3)
          if (hMid < hEarly * 1.4) return null
          return (
            <div className="callout"><i className="ph ph-warning" />
              <div><b>Atenção: o churn dispara entre os meses 3 e 6</b> — {(hMid * 100).toFixed(0)}%/mês vs {(hEarly * 100).toFixed(0)}%/mês nos primeiros meses (~{(hMid / hEarly).toFixed(1)}× mais). Coincide com o fim da comissão de 3 meses. Como o cliente precisa sobreviver a essa fase para pagar o CAC, investigar a causa (qualidade do lead indicado ou renovação de contrato) é prioridade.</div>
            </div>
          )
        })()}
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={v.ret} margin={CMARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,30,60,0.07)" />
            <XAxis dataKey="offset" tick={{ fontSize: 11 }} tickFormatter={(m) => 'M' + m} />
            <YAxis tick={{ fontSize: 11 }} width={44} domain={[0, 1]} tickFormatter={(x) => Math.round(x * 100) + '%'} />
            <Tooltip formatter={(x) => pct(x)} labelFormatter={(m) => `${m} meses após virar cliente`} />
            <Line type="monotone" dataKey="pct" stroke="#1A5CFF" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
        <div className="small muted" style={{ margin: '16px 0 8px' }}>Por safra de aquisição (mês em que viraram cliente), <b>só cohorts de 2026</b> — % ainda ativo N meses depois. Verde = retém melhor. Difere da curva acima (que usa toda a base) porque aqui cada linha é uma safra jovem, sem os sobreviventes antigos.</div>
        <div className="tablewrap">
          <table className="heatmap">
            <thead><tr><th>Safra</th><th>Clientes</th>{RET_OFFSETS.map((k) => <th key={k}>M{k}</th>)}</tr></thead>
            <tbody>{v.retMatrix.map((row) => (
              <tr key={row.cohort}>
                <td>{row.cohort}</td><td>{row.n}</td>
                {row.cells.map((c) => (
                  <td key={c.offset} className="hm" style={c.pct == null ? undefined : { background: heatColor(c.pct), color: '#0A0A0F' }}>
                    {c.pct == null ? '—' : Math.round(c.pct * 100) + '%'}
                  </td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      {/* Por programa */}
      <Section id="programa" title="Por programa" sub="Comparação entre embaixador e parceiro. ATENÇÃO: a coluna 'Conv. lead→cliente' NÃO é comparável entre os dois — o 'lead' de embaixador vem do Customer.io (amplo: todo indicado que se cadastrou, muitos de baixa intenção), enquanto o de parceiro tem outra origem/qualificação. Por isso a taxa de embaixador aparece bem menor que a de parceiro: são universos de lead diferentes, não eficiências diferentes. Compare MRR ativo e nº de clientes, não a taxa.">
        <table>
          <thead><tr><th>Programa</th><th>Referenciadores</th><th>Leads</th><th>New Customers</th><th>Conv. lead→cliente</th><th>Clientes ativos</th><th>MRR ativo</th></tr></thead>
          <tbody>{v.prog.map((p) => (
            <tr key={p.programa}>
              <td><span className={'tag ' + p.programa}>{p.programa}</span></td>
              <td>{p.referenciadores}</td><td>{p.leads}</td><td>{p.ganhos}</td><td>{pct(p.taxaConversao)}</td><td>{p.clientesAtivos}</td><td>{money(p.mrrAtivo)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      {/* Churn & saúde */}
      <Section id="saude" title="Churn & saúde do programa" sub="Churn e vida do cliente + o retrato dos embaixadores em 3 blocos que se encaixam: o roster formal do Pipedrive (funil 45), quem de fato indica, e quem gera cliente pagante.">
        <div className="stats">
          <Stat l="Churn no período" v={pct(v.qual.churnRate)} sub={`Dos ${v.qual.churnDen} clientes ativos no início do período, ${v.qual.churned} cancelaram até agora. É churn ACUMULADO da janela (${v.qual.nMonths} ${v.qual.nMonths === 1 ? 'mês' : 'meses'}) — quanto maior o período, maior o número. Para comparar, use o "Churn mensal" ao lado. A base (ativos no início) é quase toda de clientes adquiridos antes de 2026 — o "2026" é a janela do cancelamento, não a safra.`} bad />
          <Stat l="Churn mensal (equiv.)" v={pct(v.qual.churnMonthly)} sub={`O mesmo churn normalizado para taxa MENSAL equivalente (independe do tamanho da janela) — é o número comparável com o mercado. ATENÇÃO: a média mensal esconde o cliff dos meses 4–5; veja a curva na seção Retenção.`} bad />
          <Stat l="Lifetime do cliente" v={v.life.median != null ? `~${v.life.median.toFixed(1)} m (mediana)` : '—'} sub={`Metade dos clientes cancela até ~${v.life.median != null ? v.life.median.toFixed(1) : '?'} meses (mediana). ${v.life.s6 != null ? Math.round(v.life.s6 * 100) : '?'}% chegam a 6 meses e ${v.life.s12 != null ? Math.round(v.life.s12 * 100) : '?'}% a 12 meses. A média (${v.life.mean != null ? v.life.mean.toFixed(1) : '?'}m, usada no LTV) é bem maior porque os sobreviventes vivem muito — mas ela ESCONDE o cliff dos meses 4–5. Decida pelo CAC Payback.`} />
          <Stat l="Chegam a 6 meses" v={v.life.s6 != null ? pct(v.life.s6) : '—'} sub="Percentual de clientes que continua ativo 6 meses após virar cliente (curva de sobrevivência real). Abaixo disso, o cliente não passou do cliff dos meses 4–5." />
          <Stat l="Chegam a 12 meses" v={v.life.s12 != null ? pct(v.life.s12) : '—'} sub="Percentual que continua ativo 12 meses após virar cliente. É a cauda de sobreviventes que sustenta o LTV." />
        </div>
        {f.programa !== 'parceiro' && <>
        <h3 className="sub-head">Embaixadores — roster formal (Pipedrive)</h3>
        <div className="stats">
          <Stat l="No funil" v={v.sau.noFunil} sub={`Total de deals no funil de embaixadores (todos os estágios). Destes, ${v.sau.ativos} estão em "Ativados" e ${v.sau.emProcesso} ainda em processo (demonstração/negociação/onboarding).`} />
          <Stat l="Ativos" v={v.sau.ativos} sub={`Embaixadores no estágio "Ativados" — os que de fato estão no programa. É a base que importa para as taxas.`} />
          <Stat l="Em processo" v={v.sau.emProcesso} sub="Deals ainda em demonstração, negociação ou onboarding — não são embaixadores ativos ainda." />
          <Stat l="Ativos com fixo" v={`${v.sau.comFixo} · ${money(v.sau.fixoTotal)}/mês`} sub={`Dos ${v.sau.ativos} ativos, quantos recebem fixo (cada um com seu valor; permuta/só-comissão não recebem). Soma dos fixos = ${money(v.sau.fixoTotal)}/mês.`} />
        </div>
        <h3 className="sub-head">Quem realmente indica e converte</h3>
        <div className="stats">
          <Stat l="Que indicaram (total)" v={v.sau.totalQueIndicaram} sub={`Todo mundo que trouxe ao menos 1 indicação: ${v.sau.cadastradosQueIndicaram} cadastrados no funil + ${v.sau.semCadastroQueIndicaram} sem cadastro (ex.: Darlan). Nem todo cadastrado indica, e muita gente indica sem se cadastrar.`} />
          <Stat l="Ativos que indicam" v={`${v.sau.ativosQueIndicaram}/${v.sau.ativos}`} sub={`Dos ${v.sau.ativos} embaixadores ativos, quantos realmente trouxeram indicação (${pct(v.sau.taxaIndicamAtivos)}). Estar ativo no funil ≠ estar indicando.`} />
          <Stat l="Sem cadastro que indicam" v={v.sau.semCadastroQueIndicaram} sub="Pessoas que indicam sem estar no funil do Pipedrive. Frequentemente trazem tanto (ou mais) que os cadastrados." />
          <Stat l="Geraram cliente pagante" v={`${v.sau.queGeraramCliente}/${v.sau.totalQueIndicaram}`} sub={`Dos ${v.sau.totalQueIndicaram} que indicaram, ${v.sau.queGeraramCliente} chegaram a gerar ao menos 1 cliente pagante (${pct(v.sau.taxaConversaoIndicadores)}). Destes, ${v.sau.ativosQueGeraramCliente} são ativos do funil e ${v.sau.semCadastroQueGeraramCliente} sem cadastro.`} />
        </div>
        </>}
      </Section>

      {/* Mix de Tier */}
      <Section id="tier" title="Mix de Tier" sub="Distribuição por porte da empresa do cliente (Tier 1 = maiores, Tier 4 = menores), dentro do período filtrado. Mostra que tipo de empresa o programa costuma trazer.">
        <div className="metric-cards mini">
          {[['leads', 'Leads'], ['active', 'Active Customers']].map(([k, l]) => (
            <button key={k} className={'metric-card' + (tierPop === k ? ' on' : '')} style={{ '--mc': '#1A5CFF' }} onClick={() => setTierPop(k)}><div className="mc-l">{l}</div></button>
          ))}
        </div>
        <div className="tier-total">{numfmt(curTierTotal)} <span className="muted">{curTierUnit} no período</span></div>
        <div className="tiers">
          {[1, 2, 3, 4].map((t) => (
            <div key={t} className="tierbar">
              <span className="small">Tier {t}</span>
              <div className="bar"><div style={{ width: barW(curTier, t) }} /></div>
              <span className="small">{numfmt(curTier[t])} · {pct(curTierTotal ? curTier[t] / curTierTotal : 0)}</span>
            </div>
          ))}
          {curTier['?'] > 0 && (
            <div className="tierbar">
              <span className="small muted">Sem tier</span>
              <div className="bar"><div style={{ width: barW({ ...curTier, 0: curTier['?'] }, 0) }} /></div>
              <span className="small muted">{numfmt(curTier['?'])} · {pct(curTierTotal ? curTier['?'] / curTierTotal : 0)}</span>
            </div>
          )}
        </div>
      </Section>

      <footer className="muted small">
        Números por referenciador são <strong>piso</strong> (atribuição via query string subconta). ·
        Comissão = 100% dos 3 primeiros meses, automática a todo embaixador; fixo só cadastrados. ·
        CAC Payback = CAC ÷ ARPA do cohort. · Fonte: Customer.io + Pipedrive.
      </footer>
      </main>
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
    </div>
  )
}

const short = (n) => (n ? n.split(/\s+/).slice(0, 2).join(' ') : n)
const barW = (tiers, t) => { const max = Math.max(1, ...[1, 2, 3, 4].map((x) => tiers[x])); return (100 * (tiers[t] || 0) / max).toFixed(0) + '%' }
const heatColor = (pct) => `hsl(${Math.round(pct * 130)}, 62%, 60%)` // 0=vermelho → 1=verde

function Funnel({ f }) {
  const conv = (a, b) => (b ? (100 * a / b).toFixed(a / b >= 0.1 ? 0 : 1) + '%' : '—')
  const Step = ({ v, l, sub }) => (
    <div className="funnel-step">
      <div className="fs-v">{typeof v === 'number' ? numfmt(v) : v}</div>
      <div className="fs-l">{l}</div>
      <div className="fs-sub muted small">{sub}</div>
    </div>
  )
  return (
    <div className="funnel">
      <div className="funnel-head small muted">Funil de indicações — sempre programa embaixador, no período (ignora o filtro de programa acima) · Indicações e Ganhos vêm do Customer.io, Negócios do Pipedrive</div>
      <div className="funnel-row">
        <Step v={f.leads} l="Indicações" sub="Customer.io" />
        <div className="funnel-arrow"><span>{conv(f.negocios, f.leads)}</span></div>
        <Step v={f.hasPd ? f.negocios : '—'} l="Negócios" sub="Pipedrive" />
        <div className="funnel-arrow"><span>{f.hasPd ? conv(f.ganhos, f.negocios) : '—'}</span></div>
        <Step v={f.ganhos} l="Ganhos" sub="clientes fechados" />
      </div>
    </div>
  )
}
function TopTip({ active, payload, label, metrics }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return <div className="rtt"><div className="rtt-h">{label}</div>
    {metrics.map((m) => <div key={m.key} style={{ color: m.color }}>{m.label}: {m.money ? money(row[m.key]) : numfmt(row[m.key])}</div>)}
  </div>
}
function Delta({ v, cv, up }) {
  if (cv == null || cv === 0 || v == null) return null
  const d = (v - cv) / Math.abs(cv); const good = d >= 0 === up
  return <span className={'delta ' + (good ? 'pos' : 'neg')}>{d >= 0 ? '▲' : '▼'} {(Math.abs(d) * 100).toFixed(0)}%</span>
}
function LtvCac({ x }) { if (x == null) return '—'; return <span className={x >= 3 ? 'pos' : x >= 1 ? 'warn' : 'neg'}>{x.toFixed(1)}</span> }
function Payback({ m }) { if (m == null) return '—'; return <span className={m <= 6 ? 'pos' : m <= 12 ? 'warn' : 'neg'}>{m.toFixed(1)}m</span> }
function Sel({ label, value, onChange, opts }) {
  return <label><span>{label}</span><select value={value} onChange={onChange}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
}
function Section({ id, title, sub, children }) {
  return <section id={id} className="card"><h2>{title}{sub && <span className="info" tabIndex={0} aria-label={sub}><i className="ph ph-question" /><span className="info-tip">{sub}</span></span>}</h2>{children}</section>
}
// Colunas da Eficiência: rótulo + explicação (tooltip no cabeçalho) + como renderizar.
const EF_COLS = [
  { key: 'email', label: 'E-mail', tip: 'Quem indicou, identificado pelo e-mail. Passe o mouse sobre a linha para ver o nome. Clique na linha para abrir o mix de tier dos leads.', type: 'email' },
  { key: 'registered', label: 'Cad.', tip: 'Está no funil formal do Pipedrive? 🟢 = sim (embaixador no estágio Ativados). — = indica sem cadastro.', type: 'bool' },
  { key: 'mrrShare', label: '% MRR', tip: 'Quanto do MRR ativo do programa vem deste indicador. Alto = o programa depende muito dele (risco de concentração).', type: 'pct' },
  { key: 'leads', label: 'Leads', tip: 'Quantas indicações (leads) esta pessoa trouxe no período. Clique na linha para ver a divisão por tier.', type: 'num' },
  { key: 'newCustomers', label: 'New cust.', tip: 'Quantos desses leads viraram cliente pagante no período.', type: 'num' },
  { key: 'taxaConversao', label: '% conv.', tip: 'Dos leads que trouxe, quantos % viraram cliente pagante (New cust. ÷ Leads).', type: 'pct' },
  { key: 'cac', label: 'CAC', tip: 'Custo de aquisição: quanto custou trazer cada cliente novo = (comissão dos 3 primeiros meses + fixo do período) ÷ nº de clientes novos.', type: 'money' },
  { key: 'ltvCac', label: 'LTV/CAC', tip: 'Valor do cliente na vida ÷ custo de trazê-lo. ≥3 saudável, 1–3 marginal, <1 destrói valor. É referência, não veredito (a média esconde o cliff dos meses 4-5).', type: 'ltvcac' },
  { key: 'payback', label: 'CAC Payback', tip: 'Em quantos meses o cliente devolve o que custou trazê-lo. É o número mais confiável para decidir (depende dos primeiros meses, já observados).', type: 'payback' },
  { key: 'mrrAtivo', label: 'MRR ativo', tip: 'Receita recorrente mensal dos clientes desta pessoa que estão ativos hoje.', type: 'money' },
  { key: 'investimentoTotal', label: 'Invest. total', tip: 'Total investido nesta pessoa na vida toda: fixo × meses de parceria + toda a comissão paga.', type: 'money' },
  { key: 'receita', label: 'Receita', tip: 'Receita total que os clientes desta pessoa já geraram (tudo que pagaram até hoje).', type: 'money' },
  { key: 'net', label: GROSS_MARGIN < 1 ? 'Contribuição' : 'Net', tip: 'Receita gerada − investimento total. Verde = já deu lucro; vermelho = ainda no vermelho.', type: 'net' },
]
function efCell(c, r) {
  switch (c.type) {
    case 'email': return r.email || r.key
    case 'bool': return r.registered ? '🟢' : '—'
    case 'pct': return pct(r[c.key])
    case 'money': return r[c.key] != null ? money(r[c.key]) : '—'
    case 'ltvcac': return <LtvCac x={r.ltvCac} />
    case 'payback': return <Payback m={r.payback} />
    case 'net': return money(r.net)
    default: return r[c.key]
  }
}
function efCellClass(c, r) {
  if (c.type === 'email') return 'email'
  if (c.key === 'mrrShare') return r.mrrShare > 0.3 ? 'neg' : ''
  if (c.type === 'net') return r.net >= 0 ? 'pos' : 'neg'
  return ''
}
function EficienciaTable({ rows, tiers }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ col: 'newCustomers', dir: 'desc' })
  const [open, setOpen] = useState(() => new Set())
  const ql = q.trim().toLowerCase()
  const filtered = ql ? rows.filter((r) => (r.email || '').toLowerCase().includes(ql) || (r.name || '').toLowerCase().includes(ql)) : rows
  const dir = sort.dir === 'desc' ? -1 : 1
  const list = [...filtered].sort((a, b) => {
    if (sort.col === 'email') return dir * String(a.email || '').localeCompare(String(b.email || ''))
    const x = a[sort.col] == null ? -Infinity : a[sort.col], y = b[sort.col] == null ? -Infinity : b[sort.col]
    return x < y ? -dir : x > y ? dir : 0
  })
  const clickSort = (col) => setSort((s) => s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: col === 'email' ? 'asc' : 'desc' })
  const toggle = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  return (
    <>
      <div className="ef-search">
        <i className="ph ph-magnifying-glass" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail…" />
        {ql && <span className="ef-count">{list.length} de {rows.length}</span>}
      </div>
      <div className="tablewrap">
        <table className="ef-table">
          <thead><tr>
            {EF_COLS.map((c) => (
              <th key={c.key} className={'sortable' + (sort.col === c.key ? ' sorted' : '')} onClick={() => clickSort(c.key)}>
                <span className="th-in">{c.label}{sort.col === c.key && <i className={'ph ph-caret-' + (sort.dir === 'desc' ? 'down' : 'up')} />}</span>
                <span className="th-tip">{c.tip}</span>
              </th>
            ))}
          </tr></thead>
          <tbody>{list.map((r) => {
            const tm = tiers[r.key], isOpen = open.has(r.key)
            return (
              <Fragment key={r.key}>
                <tr className={'ef-row' + (isOpen ? ' open' : '')} onClick={() => toggle(r.key)}>
                  {EF_COLS.map((c) => (
                    <td key={c.key} className={efCellClass(c, r)} title={c.type === 'email' ? (r.name || '') : undefined}>{efCell(c, r)}</td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="ef-expand">
                    <td colSpan={EF_COLS.length}>
                      <div className="ef-tier">
                        <b>{short(r.name) || r.email}</b> — mix de tier dos {r.leads} leads no período:
                        {tm && r.leads ? [1, 2, 3, 4, '?'].map((t) => (tm[t] ? <span key={t} className="ef-tier-pill">Tier {t === '?' ? '?' : t}: <b>{tm[t]}</b></span> : null)) : <span className="muted"> nenhum lead no período.</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}
function Stat({ l, v, sub, good, bad, delta }) {
  return <div className="stat">{sub && <span className="info" tabIndex={0} aria-label={sub}><i className="ph ph-question" /><span className="info-tip">{sub}</span></span>}<div className={'stat-v ' + (good ? 'pos' : bad ? 'neg' : '')}>{v}</div><div className="stat-l">{l}</div>{delta}</div>
}
