import { useEffect, useMemo, useState } from 'react'
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
  cohortRetentionMatrix, RET_OFFSETS, curveLifetime, programLifetime,
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
  { key: 'cancellations', kpiKey: 'cancelados', label: 'Customer Cancellations', color: '#C77A16', up: false },
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
    let series = monthlySeries(sc, sl, A, range.from.slice(0, 7), range.to.slice(0, 7))
    if (cmp) series = mergeByIndex(series, monthlySeries(sc, sl, A, cmp.from.slice(0, 7), cmp.to.slice(0, 7)), [...NORMK, 'mrr', 'lostMrr'])
    series = addNorm(series, NORMK)
    const allC = scopeClients(raw.clients, { ...f, programa: 'todos' }), allL = scopeLeads(raw.leads || [], { ...f, programa: 'todos' })
    // Funil de indicações (sempre programa embaixador — casa com o rótulo dos negócios no Pipedrive)
    const sumPd = (period) => (raw.pdDaily || []).filter((r) => r.period === period && r.snapshot_date >= range.from && r.snapshot_date <= range.to).reduce((s, r) => s + (r.value || 0), 0)
    const funnel = {
      leads: (raw.leads || []).filter((l) => l._programa === 'embaixador' && inRange(l.lead_date, range)).length,
      negocios: sumPd('created'),
      ganhos: raw.clients.filter((c) => c._programa === 'embaixador' && inRange(wonDate(c), range)).length,
      hasPd: (raw.pdDaily || []).length > 0,
    }
    return {
      funnel,
      kpi: computeKpis(sc, sl, A, range), kpiCmp: cmp ? computeKpis(sc, sl, A, cmp) : null,
      mrr: mrrSection(sc, range), mrrCmp: cmp ? mrrSection(sc, cmp) : null,
      qual: qualidade(sc, range), sau: saudePrograma(A, R), conc: concentracao(sc, range, R),
      ret: retentionCurve(sc, asOf), retMatrix: cohortRetentionMatrix(sc, asOf),
      lifeLow: curveLifetime(sc, asOf, undefined, false), lifeHigh: curveLifetime(sc, asOf),
      mrrMov: (() => { const ms = mrrSnapshotMonths(raw.mrrSnap || []); return ms.length >= 2 ? mrrMovements(raw.mrrSnap, ms[ms.length - 2], ms[ms.length - 1]) : null })(),
      snapMonths: mrrSnapshotMonths(raw.mrrSnap || []).length,
      ef: eficienciaCohort(sc, A, R, leadsByReferrer(sl, range), range, asOf),
      prog: byPrograma(allC, allL, range), payback: cumulativeContribution(sc, A),
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
              <div className="mc-l"><span className="mc-dot" style={{ background: m.color }} />{m.label}</div>
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
          <Stat l="Custo por lead" v={v.kpi.custoPorLead != null ? money(v.kpi.custoPorLead) : '—'} sub="Quanto o programa gastou (fixo + comissão) para cada indicação que entrou no período. Serve para comparar o canal de indicação com outros canais de aquisição." delta={v.kpiCmp && <Delta v={v.kpi.custoPorLead} cv={v.kpiCmp.custoPorLead} up={false} />} />
          <Stat l="Custo por cliente novo" v={v.kpi.custoPorCliente != null ? money(v.kpi.custoPorCliente) : '—'} sub="Quanto o programa gastou para cada cliente novo que fechou no período. É o custo de aquisição por cliente, pelo canal de indicação." delta={v.kpiCmp && <Delta v={v.kpi.custoPorCliente} cv={v.kpiCmp.custoPorCliente} up={false} />} />
        </div>
      </section>

      {/* MRR */}
      <Section id="mrr" title="MRR">
        <div className="stats">
          <Stat l="MRR ativo" v={money(v.mrr.mrrAtivo)} sub="Receita recorrente mensal da base ativa hoje: a soma do valor de contrato de todos os clientes ativos do programa. É o 'estoque' de receita." delta={v.mrrCmp && <Delta v={v.mrr.mrrAtivo} cv={v.mrrCmp.mrrAtivo} up />} />
          <Stat l="ARPA (ticket médio)" v={money(v.kpi.arpa)} sub="Ticket médio: quanto cada cliente ativo paga por mês, em média. É a receita recorrente (MRR) dividida pelo número de clientes ativos." delta={v.kpiCmp && <Delta v={v.kpi.arpa} cv={v.kpiCmp.arpa} up />} />
          <Stat l="MRR Lost" v={money(v.mrr.mrrLost)} bad sub="Receita recorrente que saiu no período: a soma do valor de contrato dos clientes que cancelaram." delta={v.mrrCmp && <Delta v={v.mrr.mrrLost} cv={v.mrrCmp.mrrLost} up={false} />} />
          <Stat l="GRR (retenção de receita)" v={pct(v.mrr.grr)} good={v.mrr.grr >= 0.85} bad={v.mrr.grr != null && v.mrr.grr < 0.85} sub={`De tudo que a base já pagava no início do período, quanto você manteve (sem contar vendas novas). Você perdeu ${pct(v.mrr.grossMrrChurn)} da receita por cancelamento. Saudável acima de 85%.`} />
          <Stat l="MRR Growth" v={pct(v.mrr.mrrGrowth)} good={v.mrr.mrrGrowth >= 0} bad={v.mrr.mrrGrowth < 0} sub="Crescimento % da receita recorrente no período: quanto o MRR ativo variou do início ao fim (inclui vendas novas e cancelamentos)." />
          <Stat l="Net Gain MRR" v={money(v.mrr.netGain)} good={v.mrr.netGain >= 0} bad={v.mrr.netGain < 0} sub="Ganho líquido de receita no período: receita nova que entrou (New MRR) menos a que saiu por cancelamento (MRR Lost)." delta={v.mrrCmp && <Delta v={v.mrr.netGain} cv={v.mrrCmp.netGain} up />} />
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
      <Section id="eficiencia" title={f.programa === 'todos' ? 'Eficiência por indicador' : `Eficiência por ${f.programa}`} sub={`Economia por safra: o período seleciona os clientes adquiridos nele e mede CAC, payback e LTV/CAC dessa turma. Priorize o CAC PAYBACK para decisão — depende dos primeiros meses (observados). O LTV/CAC é referência: usa a vida média (Kaplan-Meier com cauda, ~10m), mas essa média esconde que ~metade dos clientes cancela no cliff do mês 4. O CAC inclui a comissão comprometida dos 3 meses. ${GROSS_MARGIN < 1 ? `Margem bruta de ${Math.round(GROSS_MARGIN * 100)}%.` : 'Sobre a receita cheia.'} Comissão paga a todo embaixador; fixo só aos cadastrados.`}>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Embaixador</th><th>Cad.</th><th>% MRR</th><th>Leads</th><th>New Customers</th><th>Conv. lead→cliente</th>
              <th>CAC</th><th>LTV/CAC</th><th>CAC Payback</th><th>MRR ativo</th><th>Investimento Total</th><th>Receita</th><th>{GROSS_MARGIN < 1 ? 'Contribuição' : 'Net'}</th>
            </tr></thead>
            <tbody>{v.ef.map((r) => (
              <tr key={r.key}>
                <td>{short(r.name) || r.key}</td><td>{r.registered ? '🟢' : '—'}</td>
                <td className={r.mrrShare > 0.3 ? 'neg' : ''}>{pct(r.mrrShare)}</td>
                <td>{r.leads}</td><td>{r.newCustomers}</td><td>{pct(r.taxaConversao)}</td>
                <td>{r.cac != null ? money(r.cac) : '—'}</td><td><LtvCac x={r.ltvCac} /></td><td><Payback m={r.payback} /></td>
                <td>{money(r.mrrAtivo)}</td><td>{money(r.investimentoTotal)}</td><td>{money(r.receita)}</td>
                <td className={r.net >= 0 ? 'pos' : 'neg'}>{money(r.net)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
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
      <Section id="retencao" title="Retenção (curva de sobrevivência)" sub="Dos clientes que já tiveram tempo de chegar ao mês N depois de virarem cliente, quantos % continuam ativos. Mostra a forma da retenção — em que mês os clientes começam a cancelar.">
        {(() => {
          const s = (k) => (v.ret.find((p) => p.offset === k) || {}).pct
          const s3 = s(3), s6 = s(6)
          if (s3 == null || s6 == null) return null
          const hEarly = 1 - Math.pow(s3, 1 / 3), hMid = 1 - Math.pow(s6 / s3, 1 / 3)
          if (hMid < hEarly * 1.4) return null
          return (
            <div className="callout"><i className="ph ph-warning" />
              <div><b>Atenção: o churn dispara entre os meses 3 e 6</b> — {(hMid * 100).toFixed(0)}%/mês vs {(hEarly * 100).toFixed(0)}%/mês nos primeiros meses (~{(hMid / hEarly).toFixed(1)}× mais). Coincide com o fim da comissão de 3 meses, e o canal embaixador cai ~2× mais que o parceiro nesse ponto. Como o cliente precisa sobreviver a essa fase para pagar o CAC, investigar a causa (qualidade do lead indicado ou renovação de contrato) é prioridade.</div>
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
        <div className="small muted" style={{ margin: '16px 0 8px' }}>Por safra de aquisição (mês em que viraram cliente) — % ainda ativo N meses depois. Verde = retém melhor.</div>
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
      <Section id="programa" title="Por programa" sub="Comparação entre embaixador e parceiro. ATENÇÃO: a coluna 'Conv. lead→cliente' NÃO é comparável entre os dois — o 'lead' de embaixador vem do Customer.io (amplo: todo indicado que se cadastrou, muitos de baixa intenção), enquanto o de parceiro tem outra origem/qualificação. Por isso embaixador aparece ~3% e parceiro ~44%: são universos de lead diferentes, não eficiências diferentes. Compare MRR ativo e nº de clientes, não a taxa.">
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
      <Section id="saude" title="Churn & saúde do programa" sub="Quem está cadastrado no programa, quem de fato traz indicação e quem gera cliente pagante. São dois universos: os cadastrados no Pipedrive e quem realmente indicou (com ou sem cadastro).">
        <div className="stats">
          <Stat l="Churn no período" v={pct(v.qual.churnRate)} sub={`Dos ${v.qual.churnDen} clientes ativos no início do período, ${v.qual.churned} cancelaram até agora. É churn ACUMULADO da janela (${v.qual.nMonths} ${v.qual.nMonths === 1 ? 'mês' : 'meses'}) — quanto maior o período, maior o número. Para comparar entre períodos ou com benchmark, use o "Churn mensal" ao lado.`} bad />
          <Stat l="Churn mensal (equiv.)" v={pct(v.qual.churnMonthly)} sub={`O mesmo churn normalizado para uma taxa MENSAL equivalente (hazard constante), independente do tamanho da janela — é o número comparável entre períodos e com mercado. ATENÇÃO: a média mensal esconde o cliff do mês 4; veja a curva na seção Retenção.`} bad />
          <Stat l="Lifetime (mediana–média)" v={v.lifeLow != null && v.lifeHigh != null ? `${Math.round(v.lifeLow)}–${Math.round(v.lifeHigh)} meses` : '—'} sub="A vida do cliente é BIMODAL: ~metade cancela no cliff do mês 4 (logo após a comissão de 3 meses) e vive pouco; os que sobrevivem ficam muito tempo. Por isso a MEDIANA (~7m, piso da faixa) é bem menor que a MÉDIA (~10m, topo — Kaplan-Meier com cauda). A média é o que o LTV usa, mas ela ESCONDE o cliff. Por isso: decida pelo CAC Payback e olhe o alerta na seção Retenção." />
          {f.programa !== 'parceiro' && <>
          <Stat l="Cadastrados" v={v.sau.cadastradosTotal} sub={`Embaixadores formalmente cadastrados no funil do Pipedrive. Destes, ${v.sau.embaixadoresAtivos} estão no estágio "Ativados".`} />
          <Stat l="Cadastrados que indicaram" v={`${v.sau.cadastradosQueIndicaram}/${v.sau.cadastradosTotal}`} sub={`Dos ${v.sau.cadastradosTotal} cadastrados, quantos realmente trouxeram ao menos 1 lead. Apenas ${v.sau.cadastradosComCliente} chegaram a trazer um cliente pagante.`} />
          <Stat l="Sem cadastro que indicaram" v={v.sau.indicadoresSemCadastro} sub="Pessoas que trouxeram indicações sem estar cadastradas no programa. Muitas vezes trazem tanto resultado quanto os cadastrados." />
          <Stat l="Total que indicaram" v={v.sau.totalQueIndicaram} sub={`Todo mundo que trouxe ao menos 1 indicação: ${v.sau.cadastradosQueIndicaram} cadastrados + ${v.sau.indicadoresSemCadastro} sem cadastro.`} />
          <Stat l="Pessoas no programa" v={v.sau.totalPessoas} sub={`Universo total envolvido: os ${v.sau.cadastradosTotal} cadastrados mais os ${v.sau.indicadoresSemCadastro} que indicaram sem se cadastrar.`} />
          <Stat l="Embaixadores que converteram" v={pct(v.sau.taxaConversaoIndicadores)} sub={`Dos ${v.sau.totalQueIndicaram} que indicaram, ${v.sau.indicadoresComCliente} geraram pelo menos 1 cliente pagante. Mostra quantos indicadores realmente convertem.`} />
          </>}
        </div>
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
function Stat({ l, v, sub, good, bad, delta }) {
  return <div className="stat">{sub && <span className="info" tabIndex={0} aria-label={sub}><i className="ph ph-question" /><span className="info-tip">{sub}</span></span>}<div className={'stat-v ' + (good ? 'pos' : bad ? 'neg' : '')}>{v}</div><div className="stat-l">{l}</div>{delta}</div>
}
