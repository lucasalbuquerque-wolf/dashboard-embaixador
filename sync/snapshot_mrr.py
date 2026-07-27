"""Snapshot mensal de MRR POR CLIENTE -> tabela snapshots (auditoria A5).

O cmv do Customer.io é um valor ÚNICO (atual), sem histórico. Sem histórico não dá
para calcular NRR/expansão/contração nem séries de MRR exatas. Este módulo grava, a
cada sync, o cmv de cada cliente ativo carimbado com o MÊS do snapshot. Acumulando
mês a mês, o dashboard passa a diferenciar o MRR por cliente entre dois meses e
computar expansão/contração/churn de receita reais (a partir do 2º mês).

  snapshot_date = 'YYYY-MM-01' (mês do snapshot) | scope='client_mrr'
  period = cio_id (o cliente) | metric='cmv' | value = cmv

Roda junto do sync (main o chama) ou standalone (semeia do data.json):
  python sync/snapshot_mrr.py
"""
import datetime

import config


def month_stamp(d=None):
    d = d or datetime.date.today()
    return f"{d.year:04d}-{d.month:02d}-01"


def rows_from_clients(clients, month=None):
    """Uma linha por cliente ATIVO com cmv>0, no mês dado (padrão: mês atual)."""
    m = month or month_stamp()
    rows = []
    for c in clients:
        cmv = c.get("cmv") or 0
        if cmv > 0 and c.get("active"):
            rows.append({"snapshot_date": m, "scope": "client_mrr",
                         "period": str(c.get("cio_id")), "metric": "cmv", "value": float(cmv)})
    return rows


def run(clients, month=None):
    rows = rows_from_clients(clients, month)
    print(f"      {len(rows)} clientes -> snapshot MRR ({rows[0]['snapshot_date'] if rows else '—'})")
    import supa
    if supa.enabled():
        supa.upsert("snapshots", rows, "snapshot_date,scope,period,metric")
        print(f"      Supabase snapshots (client_mrr): {len(rows)} linhas")
    else:
        print("      (Supabase nao configurado - pulando)")
    return rows


if __name__ == "__main__":
    import json
    data = json.loads(config.JSON_PATH.read_text(encoding="utf-8"))
    run(data.get("clients", []))
    print("OK")
