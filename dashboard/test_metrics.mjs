// Testes com ASSERÇÕES sobre um fixture congelado (data/data.json).
// Roda: node test_metrics.mjs  (sai != 0 se algum assert falhar).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as M from './src/lib/metrics.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'data.json'), 'utf8'))
const clients = M.annotate(data.clients, data.referrers)
const leads = M.annotateLeads(data.leads, data.referrers)
const amb = data.ambassadors, refs = data.referrers
const f = { programa: 'embaixador', registered: 'todos', tier: 'todos' }
const sc = M.scopeClients(clients, f)
const sl = M.scopeLeads(leads, f)
const range = { from: '2026-01-01', to: '2026-07-22' }
const asOf = new Date('2026-07-22T00:00:00Z')

let fails = 0
function ok(name, cond, detail = '') { console.log(`${cond ? '✓' : '✗ FALHOU'} ${name}${detail ? '  → ' + detail : ''}`); if (!cond) fails++ }
const approx = (a, b, tol) => Math.abs(a - b) <= tol

// --- C1: fixo com fallback é contado (não descartado por data_criacao null) -----
const fixoNominal = amb.filter((a) => a.investment_active && a.fixo_mensal > 0).reduce((s, a) => s + a.fixo_mensal, 0)
const serie = M.monthlySeries(sc, sl, amb, '2026-07', '2026-07')
const fixoNaSerie = serie[serie.length - 1].custo // custo do mês inclui fixo + comissão
ok('C1: fixo nominal > 40k (sanidade do fixture)', fixoNominal > 40000, `R$${fixoNominal}`)
ok('C1: custo mensal reflete o fixo completo (>= fixo nominal)', fixoNaSerie >= fixoNominal, `custo=${fixoNaSerie} >= fixo=${fixoNominal}`)

// --- A1: churn com numerador ⊆ denominador (taxa <= 100%, consistente) ----------
const q = M.qualidade(sc, range)
ok('A1: churn <= 100% (numerador é subconjunto)', q.churnRate <= 1, `${(q.churnRate * 100).toFixed(1)}%`)
ok('A1: churned <= churnDen', q.churned <= q.churnDen, `${q.churned}/${q.churnDen}`)

// --- A2: lifetime não é null e é positivo (estimado por 1/churn, inclui ativos) --
ok('A2: lifetime definido e > 0', q.lifetime != null && q.lifetime > 0, `${q.lifetime?.toFixed(1)}m`)

// --- C2: margem aplicada — LTV/CAC e payback usam contribuição, não receita bruta
const ef = M.eficienciaCohort(sc, amb, refs, M.leadsByReferrer(sl, range), range, asOf)
const comLtv = ef.filter((r) => r.ltvCac != null)
ok('C2: GROSS_MARGIN exposto em (0,1]', M.GROSS_MARGIN != null && M.GROSS_MARGIN > 0 && M.GROSS_MARGIN <= 1, String(M.GROSS_MARGIN))
ok('C2: há linhas com LTV/CAC calculado', comLtv.length > 0, `${comLtv.length} linhas`)
ok('C2: net = receita×margem − investimento', ef.every((r) => approx(r.net, r.receita * M.GROSS_MARGIN - r.investimentoTotal, 1)))

// --- A6: GRR/revenue churn presentes e em [0,1] ---------------------------------
const mrr = M.mrrSection(sc, range)
ok('A6: GRR presente', mrr.grr != null, `${(mrr.grr * 100).toFixed(1)}%`)
ok('A6: GRR + revenue churn ≈ 1', approx((mrr.grr ?? 0) + (mrr.grossMrrChurn ?? 0), 1, 1e-6))

// --- A3: concentração — shares em [0,1], top1<=top3, HHI em [0,1] ----------------
const con = M.concentracao(sc, range, refs)
ok('A3: top1 em [0,1]', con.top1 >= 0 && con.top1 <= 1, `${(con.top1 * 100).toFixed(1)}%`)
ok('A3: top1 <= top3', con.top1 <= con.top3 + 1e-9, `${(con.top1 * 100).toFixed(0)}% <= ${(con.top3 * 100).toFixed(0)}%`)
ok('A3: HHI em [0,1]', con.hhi >= 0 && con.hhi <= 1, con.hhi.toFixed(3))
ok('A3: n80 <= nRef', con.n80 <= con.nRef, `${con.n80}/${con.nRef}`)

// --- Saúde reconcilia (universos) -----------------------------------------------
const s = M.saudePrograma(amb, refs)
ok('Saúde: totalQueIndicaram = cadastrados + sem cadastro', s.totalQueIndicaram === s.cadastradosQueIndicaram + s.indicadoresSemCadastro, `${s.totalQueIndicaram}`)
ok('Saúde: totalPessoas = cadastrados + sem cadastro', s.totalPessoas === s.cadastradosTotal + s.indicadoresSemCadastro, `${s.totalPessoas}`)

// --- Retenção: M0 = 100%, pct sempre em [0,1] -----------------------------------
const rc = M.retentionCurve(sc, asOf)
ok('Ret: M0 = 100%', rc[0].offset === 0 && rc[0].pct === 1)
ok('Ret: pct em [0,1] e n>0 onde definido', rc.every((p) => p.pct == null || (p.pct >= 0 && p.pct <= 1 && p.n > 0)))

// --- Custo por lead/cliente presentes -------------------------------------------
const k = M.computeKpis(sc, sl, amb, range)
ok('Custo/lead e Custo/cliente definidos', k.custoPorLead != null && k.custoPorCliente != null, `lead ${Math.round(k.custoPorLead)} · cliente ${Math.round(k.custoPorCliente)}`)

// --- NRR: 1 mês → null; 2 meses sintéticos → fórmula correta --------------------
ok('NRR: com 1 mês retorna null', M.mrrMovements([{ snapshot_date: '2026-07-01', period: 'a', value: 100 }], '2026-07-01', '2026-08-01') === null)
const two = [
  { snapshot_date: '2026-07-01', period: 'a', value: 100 }, { snapshot_date: '2026-07-01', period: 'b', value: 50 },
  { snapshot_date: '2026-08-01', period: 'a', value: 120 }, // a: expansão +20 ; b: churn -50
]
const mv = M.mrrMovements(two, '2026-07-01', '2026-08-01')
ok('NRR: base 150 · exp 20 · churn 50 → (150+20−50)/150', mv && approx(mv.nrr, (150 + 20 - 50) / 150, 1e-9), mv && mv.nrr.toFixed(3))
ok('NRR: expansão=20, churned=50', mv && mv.expansion === 20 && mv.churned === 50)

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' TESTE(S) FALHARAM'}`)
process.exit(fails === 0 ? 0 : 1)
