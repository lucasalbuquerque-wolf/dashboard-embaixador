// Camada de IA: monta o contexto (dados + metodologia) e chama a API do Claude.
import {
  scopeClients, scopeLeads, computeKpis, byPrograma, eficienciaCohort,
  leadsByReferrer, saudePrograma, qualidade, mrrSection, tierMix, activeClients, lifetimeSummary,
} from './metrics'
import { methodologyText } from './faq'

const today = () => new Date().toISOString().slice(0, 10)
const r = (n) => Math.round(n || 0)

export function buildContext(raw) {
  const A = raw.ambassadors, R = raw.referrers, clients = raw.clients, leads = raw.leads || []
  const all = { programa: 'todos', registered: 'todos', tier: 'todos' }
  const emb = { ...all, programa: 'embaixador' }
  const period = { from: '2026-01-01', to: today() }
  const asOf = new Date()
  const sc = scopeClients(clients, all), sl = scopeLeads(leads, all)
  const sce = scopeClients(clients, emb), sle = scopeLeads(leads, emb)
  const kpi = computeKpis(sce, sle, A, period)
  const mrr = mrrSection(sce, period)
  const prog = byPrograma(sc, sl, period)
  const sau = saudePrograma(A, R)
  const qual = qualidade(sce, period)
  const life = lifetimeSummary(sce, asOf)
  const ef = eficienciaCohort(sce, A, R, leadsByReferrer(sle, period), period, asOf, true) // inclui fixo órfão (ex.: Peter)
  const tiers = tierMix(activeClients(sce, period))

  const progLines = prog.map((p) => `- ${p.programa}: ${p.referenciadores} referenciadores, ${p.leads} leads, ${p.ganhos} ganhos, conversão ${pctt(p.taxaConversao)}, ${p.clientesAtivos} clientes ativos, MRR R$${r(p.mrrAtivo)}`).join('\n')
  const efLines = ef.slice(0, 40).map((x) => `- ${x.name || x.key} (${x.registered ? 'cadastrado' : 'não cad'}): ${x.leads} leads, ${x.newCustomers} novos no período, conversão ${pctt(x.taxaConversao)}, CAC ${x.cac != null ? 'R$' + r(x.cac) : '—'}, LTV/CAC ${x.ltvCac != null ? x.ltvCac.toFixed(1) : '—'}, payback ${x.payback != null ? x.payback.toFixed(1) + 'm' : '—'}, MRR ativo R$${r(x.mrrAtivo)}, investimento total R$${r(x.investimentoTotal)}, net R$${r(x.net)}`).join('\n')
  const topRefs = R.filter((x) => x.n_clients > 0).sort((a, b) => b.mrr_active - a.mrr_active).slice(0, 50)
    .map((x) => `- ${x.name || x.referrer_key} | ${x.programa} | ${x.registered ? 'cadastrado' : 'não cad'} | ${x.n_clients} clientes (${x.n_active} ativos) | MRR R$${r(x.mrr_active)}`).join('\n')

  return `${methodologyText()}

# DADOS ATUAIS (período de referência: 2026 até hoje, salvo indicado)

## Programa de embaixador (2026)
Leads: ${kpi.leads} | New Customers (ganhos): ${kpi.ganhos} | Taxa de conversão: ${pctt(kpi.taxaConversao)} | Custo (fixo+comissão): R$${r(kpi.custo)} | Cancelados: ${kpi.cancelados}
Clientes ativos: ${kpi.clientesAtivos} | MRR ativo: R$${r(mrr.mrrAtivo)} | New MRR: R$${r(kpi.newMrr)} | MRR Lost: R$${r(mrr.mrrLost)} | Net Gain MRR: R$${r(mrr.netGain)} | MRR Growth: ${pctt(mrr.mrrGrowth)} | ARPA: R$${r(kpi.arpa)}
Churn no período (acumulado): ${pctt(qual.churnRate)} | Churn mensal equiv.: ${pctt(qual.churnMonthly)}
Lifetime (curva de sobrevivência): mediana ${life.median != null ? life.median.toFixed(1) + 'm' : '—'} | ${life.s6 != null ? Math.round(life.s6 * 100) : '?'}% chegam a 6 meses | ${life.s12 != null ? Math.round(life.s12 * 100) : '?'}% a 12 meses | média ${life.mean != null ? life.mean.toFixed(1) + 'm' : '—'} (a média, usada no LTV, é maior que a mediana porque os sobreviventes vivem muito; a distribuição é bimodal com cliff nos meses 4-5)
Mix de tier (clientes ativos): Tier1 ${tiers[1]}, Tier2 ${tiers[2]}, Tier3 ${tiers[3]}, Tier4 ${tiers[4]}

## Saúde do programa (embaixador) — 3 blocos que reconciliam
Roster formal (Pipedrive funil 45): ${sau.noFunil} no funil = ${sau.ativos} Ativados + ${sau.emProcesso} em processo (demo/negociação/onboarding). Dos ${sau.ativos} ativos, ${sau.comFixo} recebem fixo (cada um com seu valor; permuta/só-comissão não recebem), somando R$${r(sau.fixoTotal)}/mês. Só quem está em "Ativados" com valor de fixo entra no custo.
Quem realmente indica (referrers programa=embaixador): ${sau.totalQueIndicaram} pessoas = ${sau.cadastradosQueIndicaram} cadastrados no funil + ${sau.semCadastroQueIndicaram} sem cadastro. Dos ${sau.ativos} ativos, ${sau.ativosQueIndicaram} de fato indicaram (${pctt(sau.taxaIndicamAtivos)}) — estar ativo ≠ estar indicando.
Quem gera cliente pagante: ${sau.queGeraramCliente} dos ${sau.totalQueIndicaram} que indicaram (${pctt(sau.taxaConversaoIndicadores)}); destes ${sau.ativosQueGeraramCliente} são ativos do funil e ${sau.semCadastroQueGeraramCliente} são sem cadastro (ex.: Darlan).

## Por programa (2026)
${progLines}

## Eficiência por embaixador (cohort 2026, top 40 por novos clientes)
${efLines}

## Top referenciadores por MRR ativo (todos os programas)
${topRefs}
`
}

function pctt(n) { return n == null ? '—' : (n * 100).toFixed(1) + '%' }

const SYSTEM = `Você é o assistente do dashboard de programas de indicação da Umbler. Responda SEMPRE em português do Brasil, para pessoas NÃO técnicas. Use exclusivamente a metodologia e os DADOS ATUAIS abaixo.

Conteúdo:
- Se a resposta não estiver nos dados, diga que não está no dashboard — NUNCA invente números nem embaixadores/clientes.
- Comece pela resposta direta em UMA frase; só depois explique, se precisar. Diga de onde vem o número (métrica/seção).
- Números por embaixador são um PISO (a atribuição subconta) — mencione só quando for relevante.

Formatação (o texto é renderizado com estilo — capriche na clareza):
- Seja CONCISO. Frases curtas, parágrafos de 1-2 linhas. Nada de encher linguiça.
- Destaque os números-chave em **negrito**.
- NÃO use títulos com "##" nem linhas horizontais "---". Se precisar de um rótulo, use **negrito** curto.
- Use tabela SÓ para comparar 3+ itens em colunas, no máximo ~5 linhas (resuma o resto com "…"). Para poucos itens, use lista com "- ".`

export async function ask(messages, context) {
  const proxy = import.meta.env.VITE_AI_PROXY_URL   // produção: proxy server-side (chave fica no servidor)
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY // dev/local: chamada direta do browser
  const payload = { model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM + '\n\n' + context, messages }

  // Preferir o proxy (seguro). Chamada direta só como fallback de dev, com a chave local.
  let res
  if (proxy) {
    res = await fetch(proxy, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${supabaseToken()}` },
      body: JSON.stringify(payload),
    })
  } else if (key) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } else {
    throw new Error('IA não configurada — defina VITE_AI_PROXY_URL (produção) ou VITE_ANTHROPIC_API_KEY (dev) no .env.local.')
  }
  if (!res.ok) throw new Error(`Erro ${res.status}: ${(await res.text()).slice(0, 240)}`)
  const data = await res.json()
  return (data.content || []).map((b) => b.text || '').join('')
}

// Token da sessão Supabase (para o proxy autenticar o usuário). Import tardio p/ evitar ciclo.
function supabaseToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        return JSON.parse(localStorage.getItem(k))?.access_token || ''
      }
    }
  } catch { /* sem sessão */ }
  return ''
}
