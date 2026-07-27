// FAQ / documentação do dashboard. Usada na seção FAQ E como contexto da IA.
export const FAQ = [
  {
    cat: 'Fontes de dados',
    items: [
      { q: 'De onde vêm os dados?', a: 'De duas fontes, sincronizadas para o Supabase: o Customer.io é a fonte de verdade do cliente (MRR, tier, churn, quem indicou) e o Pipedrive é a fonte do embaixador (fixo, status, modelo) e do funil (data de fechamento "Ganho em"). Cada dado tem uma única fonte de verdade — não há duplicação.' },
      { q: 'Com que frequência o dado atualiza?', a: 'O dashboard lê de um banco (Supabase) que é atualizado por um script de sincronização. Hoje a sincronização é rodada manualmente; ela puxa tudo do Customer.io + Pipedrive, classifica e grava. A data da última sincronização fica registrada em cada registro.' },
      { q: 'Como um cliente é ligado ao embaixador que o indicou?', a: 'Pelo campo "referred_name"/"referred_email" do Customer.io — cada cliente já traz quem o indicou. Cruzamos isso com o roster de embaixadores do Pipedrive (funil 45) por e-mail ou nome.' },
    ],
  },
  {
    cat: 'Quem conta como embaixador / cliente',
    items: [
      { q: 'Quem é "cliente de embaixador"?', a: 'Quem foi indicado por alguém (tem referenciador preenchido no Customer.io) E virou pagante (tem valor de contrato > 0). Identificamos pelo referenciador, NÃO pelo campo "referred_program" (que é amplo demais — 6.887 registros, a maioria leads) nem pela etiqueta do Pipedrive (que é editada depois e não é confiável).' },
      { q: 'Por que "cadastrado" e "não cadastrado"?', a: 'Cadastrado = o referenciador está no funil de Embaixadores do Pipedrive (os formais, que podem ter fixo/comissão definidos). Não cadastrado = traz clientes mas não está no funil (ex.: Darlan, que sozinho traz mais cliente pagante que vários cadastrados). Mostramos os dois pelo nome para você decidir quem formalizar.' },
      { q: 'O que são os programas (embaixador, parceiro, franquia, indefinido)?', a: 'O Customer.io separa os programas de indicação. Embaixador é o foco deste dashboard. Parceiro e franquia são outros programas (aparecem em "Por programa" para comparação). Indefinido = referenciador que não conseguimos classificar (resíduo pequeno e antigo, pré-2026).' },
    ],
  },
  {
    cat: 'Definições das métricas',
    items: [
      { q: 'Leads', a: 'Referidos que entraram no período (pela data de criação no Customer.io). É o topo do funil.' },
      { q: 'New Customers (Ganhos)', a: 'Leads que viraram cliente pagante no período. A data de conversão é o "Ganho em" do Pipedrive; quando falta (214 casos), usamos a data de criação como aproximação.' },
      { q: 'Taxa de conversão', a: 'Ganhos ÷ Leads do período. É a taxa simples mês a mês (não por coorte), porque o trial de 7 dias é curto — lead e fechamento normalmente caem no mesmo mês.' },
      { q: 'Clientes ativos', a: 'Clientes pagantes ativos no fim do período (sem cancelamento até ali). É um "estoque" (foto), não um fluxo.' },
      { q: 'MRR ativo', a: 'Soma do valor mensal do contrato (CMV) dos clientes ativos. É a receita recorrente da base.' },
      { q: 'New MRR / MRR Lost / Net Gain', a: 'New MRR = receita que entrou (CMV dos Ganhos no período). MRR Lost = receita que saiu (CMV dos cancelados no período). Net Gain MRR = New − Lost (crescimento líquido).' },
      { q: 'MRR Growth (%)', a: '(MRR ativo no fim − MRR ativo no início do período) ÷ MRR no início. É o crescimento percentual da receita recorrente no período.' },
      { q: 'Custo', a: 'O gasto real do programa no período = fixo pago aos cadastrados + comissão paga (as 3 primeiras parcelas dos clientes indicados).' },
      { q: 'ARPA', a: 'Ticket médio = MRR ativo ÷ Clientes ativos.' },
      { q: 'Customer Cancellations', a: 'Número de clientes que cancelaram no período.' },
      { q: 'Tier (porte)', a: 'Porte da empresa do cliente (1 a 4), por nº de funcionários e se tem site. NÃO é o plano contratado. Tier 1 = maiores; Tier 4 = menores.' },
    ],
  },
  {
    cat: 'Eficiência por embaixador (cohort + CAC)',
    items: [
      { q: 'Por que "cohort" (safra)?', a: 'É o padrão de mercado para avaliar canal/parceiro por período: o período seleciona a SAFRA de clientes adquiridos nele, e medimos o CAC, LTV e payback dessa safra. Olhar só o acumulado "blended" esconde se quem você traz hoje vale mais ou menos que antes.' },
      { q: 'Como o CAC é calculado?', a: 'CAC = (comissão COMPROMETIDA dos clientes da safra + fixo do embaixador no período) ÷ nº de novos clientes da safra. Comissão comprometida = CMV × 3 (as 3 primeiras parcelas são o custo de aquisição, independente de já terem sido pagas — assim safras recentes não parecem artificialmente baratas). É o CAC do CANAL (comissão + fixo); não inclui custo interno de vendas/CS.' },
      { q: 'O que é CAC Payback (meses)?', a: 'Quantos meses de receita do cliente para recuperar o CAC = CAC ÷ ARPA da safra (sobre a receita cheia — não descontamos custo de servir/COGS). Os limiares do semáforo (<6 verde etc.) são METAS internas do programa — o benchmark de mercado B2B SaaS é 12–18 meses. Como a comissão ≈ 3× a mensalidade, o payback tende a ~3–4 meses por construção.' },
      { q: 'O que é LTV/CAC?', a: 'Valor do cliente na vida ÷ custo de aquisição. LTV = ARPA × lifetime (sobre a receita cheia), onde lifetime = 1 ÷ churn mensal do programa (inclui clientes ainda ativos, não só os cancelados — evita viés de sobrevivência). ≥ 3 saudável, 1–3 marginal, < 1 destrói valor. Origem do 3×: David Skok/forEntrepreneurs.' },
      { q: 'Quem recebe comissão e fixo?', a: 'Comissão (100% das 3 primeiras parcelas) é AUTOMÁTICA para todo embaixador, cadastrado ou não. Fixo é exclusivo dos cadastrados que estão ativos no funil.' },
      { q: 'Investimento Total vs CAC', a: 'Investimento Total é acumulado (vida toda): fixo × meses de parceria + toda a comissão. CAC é só da safra do período. Por isso as duas colunas coexistem.' },
    ],
  },
  {
    cat: 'Outros cálculos',
    items: [
      { q: 'Break-even do programa', a: 'Curva acumulada desde jan/2026 de (receita − comissão − fixo). Quando cruza o zero, o programa se pagou. O fixo é contado por mês para todo embaixador cadastrado no Pipedrive (a partir de jan/2026); a comissão são as 3 primeiras parcelas de cada cliente. IMPORTANTE: com o custo fixo COMPLETO (antes 93% dele sumia dos cálculos), hoje o acumulado está NEGATIVO — o fixo mensal do programa supera o MRR que ele gera. Não descontamos custo de servir/COGS: é receita cheia.' },
      { q: 'Churn no período', a: 'Clientes que estavam ativos no INÍCIO do período e cancelaram nele ÷ clientes ativos no início. O numerador é subconjunto do denominador (não conta quem entrou e saiu dentro do período) — por isso é uma taxa consistente (nunca passa de 100%).' },
      { q: 'GRR / churn de receita', a: 'GRR (Gross Revenue Retention) = (MRR da base no início − MRR que cancelou dessa base) ÷ MRR no início. Mede quanto da receita da base você reteve, ignorando vendas novas. Bom > 85%. É mais importante que o churn por contagem numa base concentrada, onde perder 1 cliente grande ≠ perder 1 pequeno.' },
      { q: 'Lifetime médio', a: 'Vida média estimada = 1 ÷ churn mensal do programa (cancelamentos por cliente-mês), incluindo clientes ainda ativos. Não é a média só dos cancelados (que subestimaria e sumiria para quem tem retenção perfeita).' },
      { q: 'Concentração de risco', a: 'Share do MRR ativo por embaixador: top-1, top-3, HHI (0 = pulverizado, 1 = um só) e quantos embaixadores fazem 80% do MRR. É o maior risco do programa: hoje o maior embaixador responde por ~1/3 do MRR e o top-3 por ~2/3 — a saída de 1-2 pessoas derruba boa parte da receita.' },
      { q: 'Taxa de ativação vs Taxa de sucesso', a: 'Ativação (cadastrados) = embaixadores cadastrados que produziram ≥1 cliente ÷ total de cadastrados. Sucesso (todos) = referenciadores do programa que produziram ≥1 cliente ÷ todos (incl. não cadastrados).' },
    ],
  },
  {
    cat: 'Ressalvas importantes',
    items: [
      { q: 'Por que os números são um "piso"?', a: 'A atribuição (ReferredBy) só é capturada na hora do cadastro e não persiste em cookie. Se a pessoa clica no link, sai e volta depois sem o parâmetro, a indicação se perde. Então TODO número por embaixador é um piso, não o real — penaliza mais quem tem público que pesquisa a marca depois. Isso será corrigido no projeto paralelo de tracking.' },
      { q: 'Por que o recorte é 2026?', a: 'Antes de 2026 a etiquetagem de programa no Customer.io era incompleta (muitos clientes sem programa) e está fora de escopo. Todo cálculo do dashboard — inclusive as séries e o break-even — parte de janeiro/2026. Clientes que já eram pagantes antes de 2026 continuam contando enquanto ativos (o MRR deles entra), mas o período de análise começa em jan/2026.' },
      { q: 'O que são os 214 clientes "sem Ganho em"?', a: '214 dos clientes pagantes não têm a data de fechamento no Pipedrive (sem deal vinculado). Para eles usamos a data de criação como aproximação da conversão. Por isso a "Conversão geral" (que usa só o flag de convertido) é a mais completa.' },
      { q: 'O custo por período é exato?', a: 'O custo é reconstruído mês a mês (granularidade mensal). Para recortes de poucos dias ele aproxima pelo mês inteiro. Para análises mensais/anuais é preciso.' },
    ],
  },
  {
    cat: 'Filtros e comparação',
    items: [
      { q: 'Como funciona o filtro de período?', a: 'Um calendário estilo Google Ads: presets (Este ano, Últimos 7/30/90 dias, etc.) ou datas específicas. Liga o "Comparar" (slide) para escolher um segundo período — aí cada número mostra a variação % e os gráficos ganham uma 2ª linha pontilhada.' },
      { q: 'Os filtros Programa / Cadastro / Tier', a: 'Programa isola embaixador/parceiro/franquia. Cadastro filtra cadastrados vs não cadastrados. Tier filtra por porte da empresa do cliente. A maioria das seções respeita esses filtros.' },
    ],
  },
]

export function methodologyText() {
  return FAQ.map((g) => `## ${g.cat}\n` + g.items.map((i) => `P: ${i.q}\nR: ${i.a}`).join('\n')).join('\n\n')
}
