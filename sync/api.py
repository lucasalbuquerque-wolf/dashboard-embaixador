"""Clients de API (Customer.io + Pipedrive) usando apenas a stdlib."""
import json
import os
import time
import urllib.parse
import urllib.request
import urllib.error

import config

# Cache opt-in (SYNC_CACHE=1) das respostas por-id, p/ iterar rapido em dev.
_CACHE_ON = os.environ.get("SYNC_CACHE") == "1"
_CACHE_FILE = config.DATA_DIR / ".http_cache.json"
_cache: dict = {}
if _CACHE_ON and _CACHE_FILE.exists():
    try:
        _cache = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        _cache = {}


def _cache_get(key):
    return _cache.get(key) if _CACHE_ON else None


def _cache_put(key, val):
    if _CACHE_ON:
        _cache[key] = val


def save_cache():
    if _CACHE_ON:
        config.DATA_DIR.mkdir(exist_ok=True)
        _CACHE_FILE.write_text(json.dumps(_cache), encoding="utf-8")


def _request(url: str, method: str = "GET", headers: dict | None = None,
             body: dict | None = None, retries: int = 3):
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method,
                                         headers=headers or {})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise


class Cio:
    """Customer.io App API (data center US)."""

    def __init__(self):
        self.base = config.CIO_BASE
        self.headers = {"Authorization": f"Bearer {config.CIO_KEY}",
                        "Content-Type": "application/json"}

    def search(self, filt: dict) -> list[dict]:
        """Retorna todos os identifiers que batem no filtro (paginado)."""
        out, start = [], None
        while True:
            url = f"{self.base}/v1/customers?limit=1000" + (f"&start={start}" if start else "")
            res = _request(url, "POST", self.headers, {"filter": filt})
            batch = res.get("identifiers", [])
            out.extend(batch)
            start = res.get("next")
            if not start or not batch:
                break
        return out

    def attributes(self, cio_id: str) -> dict | None:
        ck = f"cio_attr:{cio_id}"
        hit = _cache_get(ck)
        if hit is not None:
            return hit
        url = f"{self.base}/v1/customers/{cio_id}/attributes?id_type=cio_id"
        try:
            res = _request(url, "GET", {"Authorization": f"Bearer {config.CIO_KEY}"})
        except urllib.error.HTTPError:
            return None
        _cache_put(ck, res)
        return res


class Pipedrive:
    def __init__(self):
        self.base = config.PD_BASE
        self.token = config.PD_TOKEN

    def get(self, path: str, **params):
        params["api_token"] = self.token
        url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
        try:
            return _request(url, "GET")
        except urllib.error.HTTPError:
            return {"data": None}

    def pipeline_deals(self, pipeline_id: int) -> list[dict]:
        out, start = [], 0
        while True:
            r = self.get(f"/pipelines/{pipeline_id}/deals", everyone=1, start=start, limit=500)
            data = r.get("data") or []
            out.extend(data)
            pg = (r.get("additional_data") or {}).get("pagination") or {}
            if pg.get("more_items_in_collection") and pg.get("next_start") is not None:
                start = pg["next_start"]
            else:
                break
        return out

    def person(self, person_id) -> dict:
        return self.get(f"/persons/{person_id}").get("data") or {}

    def deal(self, deal_id) -> dict | None:
        ck = f"pd_deal:{deal_id}"
        hit = _cache_get(ck)
        if hit is not None:
            return hit
        res = self.get(f"/deals/{deal_id}").get("data")
        _cache_put(ck, res)
        return res
