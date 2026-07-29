"""
Sync Customer.io + Pipedrive -> SQLite (+ data.json).

Aplica as regras validadas na descoberta:
- Cliente de embaixador = referenciador (referred_name/email), nao referred_program (amplo demais).
- Programa classificado: referred_program do CIO -> fallback origem do deal Pipedrive -> indefinido.
- Pagante = contract_month_value > 0.  Ativo = sem cancelamento (ou cancelamento futuro).
- Recorte 2026+ marcado em in_window (ingere tudo).
- Investimento do embaixador 'ativa' quando em 'Ativados' OU aparece como referenciador.

Uso:  python sync/sync.py
"""
import datetime
import json
import sqlite3
import unicodedata
from pathlib import Path

import config
from api import Cio, Pipedrive, save_cache

TODAY = datetime.date.today()


# ----------------------------- helpers ------------------------------------
def norm(s) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


def norm_email(e) -> str:
    """Normaliza e-mail e remove +alias (auditoria: gustavo+12333@ e gustavo@ = mesma pessoa)."""
    e = (e or "").lower().strip()
    if "@" not in e:
        return e
    local, dom = e.split("@", 1)
    return f"{local.split('+', 1)[0]}@{dom}"


def is_internal(email) -> bool:
    """Contas internas da Umbler (vendas@, murilo@, ...) não são embaixadores/parceiros."""
    return (email or "").lower().strip().endswith("@umbler.com")


def to_iso_date(s):
    """cancelation_date vem em formatos MISTOS: 'DD/MM/YYYY' e ISO 'YYYY-MM-DDTHH:MM:SS'."""
    if not s:
        return None
    s = str(s).strip()
    if len(s) >= 10 and s[4:5] == "-" and s[7:8] == "-":  # ISO (date ou datetime)
        return s[:10]
    parts = s.split("/")  # DD/MM/YYYY
    if len(parts) == 3:
        try:
            d, m, y = parts
            return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except Exception:
            return None
    return None


def ts_to_iso(ts):
    try:
        return datetime.datetime.utcfromtimestamp(int(ts)).date().isoformat()
    except Exception:
        return None


def compute_active(raw_cancel) -> bool:
    """Ativo = sem cancelamento OU cancelamento em data futura.
    Se ha' cancelamento mas a data nao parseia, conta como churned (fail-safe)."""
    if not raw_cancel:
        return True
    iso = to_iso_date(raw_cancel)
    if not iso:
        return False
    try:
        return datetime.date.fromisoformat(iso) > TODAY
    except Exception:
        return False


def prog_family(rp):
    if not rp:
        return None  # vazio -> tenta fallback
    if rp == "ambassador":
        return "embaixador"
    if rp == "franchise":
        return "franquia"
    if rp.startswith("partner"):
        return "parceiro"
    return "outro"


def classify_via_deal(deal):
    """Desempate por origem do deal Pipedrive. Retorna embaixador/parceiro/None."""
    if not deal:
        return None
    ids = set()
    for k in (config.CF_ORIGEM_LEAD, config.CF_GRUPO_ORIGEM, config.CF_ABORDAGEM):
        for tok in str(deal.get(k) or "").split(","):
            tok = tok.strip()
            if tok.isdigit():
                ids.add(int(tok))
    lab = deal.get("label_ids") if deal.get("label_ids") is not None else deal.get("label")
    labs = lab if isinstance(lab, list) else (str(lab).split(",") if lab not in (None, "") else [])
    for t in labs:
        if str(t).strip().isdigit():
            ids.add(int(t))
    emb = bool(ids & config.ORIGEM_EMBAIXADOR)
    par = bool(ids & config.ORIGEM_PARCEIRO)
    if emb and not par:
        return "embaixador"
    if par and not emb:
        return "parceiro"
    return None  # ambiguo ou sem sinal


# ----------------------------- extract ------------------------------------
def load_ambassadors(pd: Pipedrive):
    """Funil 45 -> embaixadores + rosters (email/nome) para o match."""
    deals = pd.pipeline_deals(config.PIPE_EMBAIXADOR)
    ambs, roster_emails, roster_names = [], set(), set()
    for d in deals:
        pid = d.get("person_id")
        pid = pid.get("value") if isinstance(pid, dict) else pid
        name = email = None
        emails = []
        if pid:
            pr = pd.person(pid)
            name = pr.get("name")
            for em in (pr.get("email") or []):
                if em.get("value"):
                    emails.append(norm_email(em["value"]))
            email = emails[0] if emails else None
        if name:
            roster_names.add(norm(name))
        for e in emails:
            roster_emails.add(e)
        labels = d.get("label_ids") if d.get("label_ids") is not None else d.get("label")
        lab_ids = labels if isinstance(labels, list) else (str(labels).split(",") if labels not in (None, "") else [])
        modelos = [config.MODEL_LABELS[int(x)] for x in lab_ids
                   if str(x).strip().isdigit() and int(x) in config.MODEL_LABELS]
        ambs.append({
            "pd_deal_id": d["id"],
            "name": name or d.get("title"),
            "email": email,
            "stage_id": d.get("stage_id"),
            "stage_name": config.STAGE_NAMES.get(d.get("stage_id"), str(d.get("stage_id"))),
            "is_ativado": int(d.get("stage_id") == config.STAGE_ATIVADOS),
            "fixo_mensal": float(d.get("value") or 0),
            "modelo": "+".join(modelos),
            # FIX (auditoria C1): 24/26 vinham com CF_DATA_CRIACAO vazio -> fallback p/ add_time do deal.
            "data_criacao": d.get(config.CF_DATA_CRIACAO) or (d.get("add_time") or "")[:10] or None,
        })
    return ambs, roster_emails, roster_names


def load_partners(pd: Pipedrive):
    """Funil 46 (Partners) -> roster de PARCEIROS formais (email/nome) para classificar referrers.
    Parceiro nao tem fixo (value=0 no funil 46); o roster serve so' para marcar quem e' parceiro
    formal e impedir que a maioria de tags o classifique errado."""
    emails, names = set(), set()
    try:
        deals = pd.pipeline_deals(config.PIPE_PARCEIRO)
    except Exception as e:
        print(f"      load_partners ERRO (segue sem roster de parceiro): {str(e)[:150]}")
        return emails, names
    for d in deals:
        pid = d.get("person_id")
        pid = pid.get("value") if isinstance(pid, dict) else pid
        if not pid:
            continue
        pr = pd.person(pid)
        if pr.get("name"):
            names.add(norm(pr["name"]))
        for em in (pr.get("email") or []):
            if em.get("value"):
                emails.add(norm_email(em["value"]))
    return emails, names


def load_referred(cio: Cio, pd: Pipedrive, roster_emails, roster_names):
    """Puxa TODOS os referidos (leads + clientes). converted = tem contract_month_value > 0.
    Para os convertidos, busca o deal (won_time + desempate de origem)."""
    pop = {"or": [{"attribute": {"field": "referred_name", "operator": "exists"}},
                  {"attribute": {"field": "referred_email", "operator": "exists"}}]}
    ids = cio.search(pop)
    print(f"  referidos (leads + clientes): {len(ids)} (buscando atributos...)")
    leads, clients = [], []
    for i, x in enumerate(ids, 1):
        if i % 500 == 0:
            print(f"    {i}/{len(ids)}")
        cid = x.get("cio_id")
        c = cio.attributes(cid)
        if not c:
            continue
        a = c.get("customer", {}).get("attributes", {})
        ts = c.get("customer", {}).get("timestamps", {})
        try:
            cmv = float(a.get("contract_month_value") or 0)
        except Exception:
            cmv = 0.0
        converted = cmv > 0
        ref_email = norm_email(a.get("referred_email"))
        ref_name = a.get("referred_name")
        key = ref_email or norm(ref_name)
        raw_cancel = a.get("cancelation_date")
        cancel_iso = to_iso_date(raw_cancel)
        created_iso = ts_to_iso(ts.get("cio_id") or ts.get("anonymous_id"))
        active = int(compute_active(raw_cancel))
        tier = int(a["tier"]) if str(a.get("tier") or "").isdigit() else None
        in_win = int(bool(created_iso) and created_iso >= config.CUTOFF)
        crm_deal = a.get("crm_deal")
        fam = prog_family(a.get("referred_program"))

        deal = None
        if converted:
            deal = pd.deal(crm_deal) if crm_deal else None
            if fam:
                programa, fonte = fam, "cio_program"
            else:
                via = classify_via_deal(deal)
                programa, fonte = (via, "pipedrive_deal") if via else ("indefinido", "indefinido")
        else:
            programa = fam or "indefinido"
            fonte = "cio_program" if fam else "indefinido"
        ganho_em = ((deal or {}).get("won_time") or "")[:10] or None

        leads.append({
            "cio_id": cid, "email": a.get("email"),
            "referred_name": ref_name, "referred_email": ref_email, "referrer_key": key,
            "referred_program": a.get("referred_program"), "programa": programa,
            "converted": int(converted), "cmv": cmv, "lead_date": created_iso,
            "ganho_em": ganho_em, "cancelation_date": cancel_iso, "active": active,
            "tier": tier, "in_window": in_win,
        })
        if converted:
            clients.append({
                "cio_id": cid, "email": a.get("email"),
                "referred_name": ref_name, "referred_email": ref_email, "referrer_key": key,
                "referred_program": a.get("referred_program"),
                "programa": programa, "programa_fonte": fonte,
                "cmv": cmv, "active": active, "cancelation_date": cancel_iso,
                "ganho_em": ganho_em, "created_at_cio": created_iso,
                "cohort_month": created_iso[:7] if created_iso else None,
                "in_window": in_win, "tier": tier, "crm_deal": crm_deal,
                "pd_pipeline_id": (deal or {}).get("pipeline_id"),
                "registered_ambassador": int(key in roster_emails or norm(ref_name) in roster_names),
            })
    return leads, clients


# ----------------------------- transform ----------------------------------
def build_referrers(leads, roster_emails, roster_names, partner_emails=None, partner_names=None):
    partner_emails = partner_emails or set()
    partner_names = partner_names or set()
    groups = {}
    for l in leads:
        g = groups.setdefault(l["referrer_key"], {
            "referrer_key": l["referrer_key"], "name": l["referred_name"],
            "email": l["referred_email"], "progs": [], "n_clients": 0,
            "n_active": 0, "mrr_active": 0.0,
        })
        if l["referred_name"] and not g["name"]:
            g["name"] = l["referred_name"]
        g["progs"].append(l["programa"])
        if l["converted"]:
            g["n_clients"] += 1
            if l["active"]:
                g["n_active"] += 1
                g["mrr_active"] += l["cmv"]
    refs = []
    for key, g in groups.items():
        registered = (key in roster_emails) or (norm(g["name"]) in roster_names)
        in_partner = (key in partner_emails) or (norm(g["name"]) in partner_names)
        non_indef = [p for p in g["progs"] if p != "indefinido"]
        # Classificacao ROSTER-FIRST (revisao 2026-07, SA-3): o funil formal manda; so' depois a
        # maioria REAL das tags. Antes a regra "embaixador vence se presente" apagava parceiros mistos.
        if is_internal(g["email"]) or is_internal(key):
            programa = "interno"       # contas @umbler.com nao sao embaixadores/parceiros
        elif registered:
            programa = "embaixador"    # roster formal do funil 45
        elif in_partner:
            programa = "parceiro"      # roster formal do funil 46 (Partners)
        elif non_indef:
            programa = max(set(non_indef), key=non_indef.count)   # maioria real das tags
        else:
            programa = "indefinido"
        refs.append({**{k: g[k] for k in ("referrer_key", "name", "email",
                                          "n_clients", "n_active", "mrr_active")},
                     "programa": programa, "registered": int(registered),
                     "pd_ambassador_id": None})
    return refs


def mark_investment_active(ambs, refs):
    ref_by_email = {r["email"]: r for r in refs if r["email"]}
    ref_by_name = {norm(r["name"]): r for r in refs}
    for amb in ambs:
        r = ref_by_email.get((amb["email"] or "").lower().strip()) or ref_by_name.get(norm(amb["name"]))
        has_ref = bool(r and r["n_clients"] > 0)
        amb["has_referral"] = int(has_ref)
        amb["investment_active"] = int(bool(amb["is_ativado"]) or has_ref)
        if r:
            r["pd_ambassador_id"] = amb["pd_deal_id"]


# ----------------------------- load ---------------------------------------
AMB_COLS = ["pd_deal_id", "name", "email", "stage_id", "stage_name", "is_ativado",
            "fixo_mensal", "modelo", "data_criacao", "has_referral",
            "investment_active", "synced_at"]
REF_COLS = ["referrer_key", "name", "email", "programa", "registered",
            "pd_ambassador_id", "n_clients", "n_active", "mrr_active", "synced_at"]
CLI_COLS = ["cio_id", "email", "referred_name", "referred_email", "referrer_key",
            "referred_program", "programa", "programa_fonte", "cmv", "active",
            "cancelation_date", "ganho_em", "created_at_cio", "cohort_month",
            "in_window", "tier", "crm_deal", "pd_pipeline_id",
            "registered_ambassador", "synced_at"]
LEAD_COLS = ["cio_id", "email", "referred_name", "referred_email", "referrer_key",
             "referred_program", "programa", "converted", "cmv", "lead_date",
             "ganho_em", "cancelation_date", "active", "tier", "in_window", "synced_at"]
TABLES = [("ambassadors", AMB_COLS, "pd_deal_id"),
          ("referrers", REF_COLS, "referrer_key"),
          ("clients", CLI_COLS, "cio_id"),
          ("leads", LEAD_COLS, "cio_id")]


def stamp(data, now):
    for rows in data.values():
        for r in rows:
            r["synced_at"] = now


def write_db(data):
    config.DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(config.DB_PATH)
    con.executescript((Path(__file__).parent / "schema.sql").read_text(encoding="utf-8"))
    cur = con.cursor()
    for table, cols, _ in TABLES:
        cur.execute(f"DELETE FROM {table}")
        cur.executemany(
            f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [[r.get(c) for c in cols] for r in data[table]])
    con.commit()
    con.close()


def validate_before_write(data):
    """Guarda contra falha parcial de API (auditoria): aborta ANTES de gravar se alguma
    tabela veio vazia ou caiu >40% vs. o run anterior (data.json). Fail loud, nada é gravado."""
    prev = {}
    if config.JSON_PATH.exists():
        try:
            old = json.loads(config.JSON_PATH.read_text(encoding="utf-8"))
            prev = {t: len(old.get(t, [])) for t in ("ambassadors", "referrers", "clients", "leads")}
        except Exception:
            prev = {}
    for t in ("ambassadors", "referrers", "clients", "leads"):
        n = len(data[t])
        if n == 0:
            raise RuntimeError(f"ABORTADO: tabela '{t}' veio VAZIA (provável falha de API). NADA foi gravado.")
        if prev.get(t) and n < prev[t] * 0.6:
            raise RuntimeError(f"ABORTADO: '{t}' caiu de {prev[t]} p/ {n} (>40%). Suspeita de falha parcial. NADA foi gravado.")
    print(f"      validação ok: amb={len(data['ambassadors'])} ref={len(data['referrers'])} cli={len(data['clients'])} leads={len(data['leads'])}")


def push_supabase(data, run_ts):
    import supa
    if not supa.enabled():
        print("      (Supabase nao configurado - pulando)")
        return
    for table, cols, pk in TABLES:
        rows = [{c: r.get(c) for c in cols} for r in data[table]]
        try:
            supa.upsert(table, rows, pk)
            removed = supa.delete_stale(table, run_ts)   # espelha deleções da origem (órfãos)
            extra = f" (removidos {removed} órfãos)" if removed else ""
            print(f"      Supabase {table}: {len(rows)} linhas{extra}")
        except Exception as e:
            print(f"      Supabase {table}: ERRO {str(e)[:200]}")


def export_json(data):
    config.JSON_PATH.write_text(json.dumps({
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "cutoff": config.CUTOFF, **data,
    }, ensure_ascii=False), encoding="utf-8")


def summary(refs, clients):
    from collections import defaultdict
    print("\n=== RESUMO ===")
    agg = defaultdict(lambda: [0, 0, 0, 0.0])  # refs, clients, active, mrr
    cli_by_ref = defaultdict(list)
    for c in clients:
        cli_by_ref[c["referrer_key"]].append(c)
    for r in refs:
        bucket = f'{r["programa"]}{"/cadastrado" if r["registered"] else ""}'
        a = agg[bucket]
        a[0] += 1
        a[1] += r["n_clients"]
        a[2] += r["n_active"]
        a[3] += r["mrr_active"]
    print(f'  {"bucket":24} {"refs":>5} {"cli":>5} {"ativ":>5} {"MRR":>9}')
    for b, a in sorted(agg.items(), key=lambda x: -x[1][1]):
        print(f"  {b:24} {a[0]:>5} {a[1]:>5} {a[2]:>5} {a[3]:>9.0f}")
    win = [c for c in clients if c["in_window"]]
    print(f"\n  total clientes pagantes: {len(clients)} | no recorte 2026+: {len(win)}")
    print(f"  indefinidos: {sum(1 for c in clients if c['programa']=='indefinido')} "
          f"(2026+: {sum(1 for c in win if c['programa']=='indefinido')})")


def main():
    assert config.CIO_KEY and config.PD_TOKEN, "Faltam credenciais no .env"
    cio, pd = Cio(), Pipedrive()
    print("[1/4] Embaixadores (funil 45) + Parceiros (funil 46)...")
    ambs, r_emails, r_names = load_ambassadors(pd)
    p_emails, p_names = load_partners(pd)
    print(f"      {len(ambs)} embaixadores | {len(p_emails)} parceiros no roster")
    print("[2/4] Referidos: leads + clientes (Customer.io + deals)...")
    leads, clients = load_referred(cio, pd, r_emails, r_names)
    print(f"      {len(leads)} leads ({len(clients)} convertidos/pagantes)")
    print("[3/4] Referenciadores + investimento...")
    refs = build_referrers(leads, r_emails, r_names, p_emails, p_names)
    mark_investment_active(ambs, refs)
    print(f"      {len(refs)} referenciadores")
    print("[4/4] Gravando SQLite + Supabase + data.json...")
    data = {"ambassadors": ambs, "referrers": refs, "clients": clients, "leads": leads}
    validate_before_write(data)   # aborta se falha parcial de API (tabela vazia / queda brusca)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    stamp(data, now)
    write_db(data)
    export_json(data)
    push_supabase(data, now)
    print("[+] Negocios Pipedrive (funil de indicacoes) -> snapshots...")
    try:
        import snapshot_deals
        snapshot_deals.run(pd)
    except Exception as e:
        print(f"      snapshot_deals ERRO: {str(e)[:200]}")
    print("[+] Snapshot mensal de MRR por cliente (desbloqueia NRR) -> snapshots...")
    try:
        import snapshot_mrr
        snapshot_mrr.run(clients)
    except Exception as e:
        print(f"      snapshot_mrr ERRO: {str(e)[:200]}")
    save_cache()
    summary(refs, clients)
    print("\nOK -> SQLite (local) + Supabase (online)")


if __name__ == "__main__":
    main()
