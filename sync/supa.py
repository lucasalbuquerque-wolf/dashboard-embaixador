"""Loader para Supabase via PostgREST (apenas stdlib). Usa a chave secreta,
que ignora o RLS (o sync escreve; o frontend le' so' autenticado)."""
import json
import urllib.request
import urllib.error
import urllib.parse

import config


def enabled() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SECRET)


def upsert(table: str, rows: list[dict], on_conflict: str, chunk: int = 500):
    if not enabled() or not rows:
        return
    url = f"{config.SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {
        "apikey": config.SUPABASE_SECRET,
        "Authorization": f"Bearer {config.SUPABASE_SECRET}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for i in range(0, len(rows), chunk):
        body = json.dumps(rows[i:i + chunk], ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            urllib.request.urlopen(req, timeout=120).read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {table} erro {e.code}: {e.read().decode()[:400]}")


def delete_stale(table: str, synced_at: str):
    """Remove linhas nao tocadas neste run (synced_at != valor atual) = orfaos, espelhando
    as delecoes da origem. So chamar APOS um upsert bem-sucedido da tabela. Retorna nº removido."""
    if not enabled():
        return 0
    val = urllib.parse.quote(str(synced_at), safe="")
    url = f"{config.SUPABASE_URL}/rest/v1/{table}?synced_at=neq.{val}"
    headers = {
        "apikey": config.SUPABASE_SECRET,
        "Authorization": f"Bearer {config.SUPABASE_SECRET}",
        "Prefer": "count=exact",
    }
    req = urllib.request.Request(url, method="DELETE", headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        cr = resp.headers.get("Content-Range", "")   # ex.: "*/3"
        return int(cr.split("/")[-1]) if "/" in cr else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase delete_stale {table} erro {e.code}: {e.read().decode()[:300]}")
