"""Negocios INDICACAO-EMBAIXADOR do Pipedrive -> serie diaria na tabela snapshots.

O dash mede "Leads" pelo Customer.io (todo indicado). O Pipedrive mede "negocios"
(indicados que viraram oportunidade de venda, pipeline 25 + rotulo 1103). Este modulo
puxa esses negocios e grava contagens DIARIAS em snapshots, para o card do funil
(Indicacoes -> Negocios -> Ganhos) responder ao periodo filtrado.

  snapshot_date = dia (YYYY-MM-DD) | scope='pipedrive' | period='created'|'won'
  metric='negocios_embaixador' | value=contagem

Roda junto do sync (main o chama) ou standalone:  python sync/snapshot_deals.py
"""
import datetime
from collections import defaultdict

import config
from api import Pipedrive, save_cache

PIPE_TALK = 25            # funil "Umbler Talk" (vendas)
LABEL_EMBAIXADOR = 1103   # rotulo "INDICACAO - EMBAIXADOR"
SINCE = config.CUTOFF     # 2026-01-01 (janela confiavel; pre-2026 tinha gap de tag)


def _has_label(d, lid):
    L = d.get("label_ids") if d.get("label_ids") is not None else d.get("label")
    if L is None:
        return False
    ids = [str(x) for x in L] if isinstance(L, list) else str(L).split(",")
    return str(lid) in ids


def load_pd_deals(pd, since=SINCE, cap_pages=400):
    """Deals do pipeline 25 com rotulo 1103 e add_time >= since (todos os status)."""
    out, start, pages = [], 0, 0
    while pages < cap_pages:
        r = pd.get("/deals", sort="add_time DESC", limit=500, start=start)
        data = r.get("data") or []
        if not data:
            break
        out.extend(d for d in data
                   if d.get("pipeline_id") == PIPE_TALK and _has_label(d, LABEL_EMBAIXADOR))
        pages += 1
        oldest = str(data[-1].get("add_time") or "")[:10]
        if oldest < since:
            break
        pg = (r.get("additional_data") or {}).get("pagination") or {}
        if pg.get("more_items_in_collection") and pg.get("next_start") is not None:
            start = pg["next_start"]
        else:
            break
    return [d for d in out if str(d.get("add_time") or "")[:10] >= since]


def daily_rows(deals):
    """Agrega em linhas diarias prontas para a tabela snapshots."""
    created, won = defaultdict(int), defaultdict(int)
    for d in deals:
        a = str(d.get("add_time") or "")[:10]
        if a:
            created[a] += 1
        if d.get("status") == "won":
            w = str(d.get("won_time") or "")[:10]
            if w:
                won[w] += 1
    rows = []
    for day, n in created.items():
        rows.append({"snapshot_date": day, "scope": "pipedrive",
                     "period": "created", "metric": "negocios_embaixador", "value": n})
    for day, n in won.items():
        rows.append({"snapshot_date": day, "scope": "pipedrive",
                     "period": "won", "metric": "negocios_embaixador", "value": n})
    return rows


def run(pd=None):
    pd = pd or Pipedrive()
    deals = load_pd_deals(pd)
    rows = daily_rows(deals)
    print(f"      {len(deals)} negocios embaixador desde {SINCE} -> {len(rows)} linhas-dia")
    import supa
    if supa.enabled():
        supa.upsert("snapshots", rows, "snapshot_date,scope,period,metric")
        print(f"      Supabase snapshots: {len(rows)} linhas")
    else:
        print("      (Supabase nao configurado - pulando)")
    return rows


if __name__ == "__main__":
    run()
    save_cache()
    print("OK")
