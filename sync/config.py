"""Carrega configuracao do .env (sem dependencias externas)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict:
    env: dict[str, str] = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    for k, v in os.environ.items():  # variaveis de ambiente sobrescrevem
        env[k] = v
    return env


ENV = load_env()

CIO_KEY = ENV.get("CUSTOMERIO_APP_API_KEY")
CIO_BASE = ENV.get("CUSTOMERIO_APP_API_BASE", "https://api.customer.io")
PD_TOKEN = ENV.get("PIPEDRIVE_API_TOKEN")
PD_BASE = ENV.get("PIPEDRIVE_API_BASE", "https://umbler.pipedrive.com/api/v1")

SUPABASE_URL = ENV.get("SUPABASE_URL")
SUPABASE_SECRET = ENV.get("SUPABASE_SECRET_KEY")
SUPABASE_PUBLISHABLE = ENV.get("SUPABASE_PUBLISHABLE_KEY")

# Recorte padrao do dashboard. Ingerimos tudo, mas marcamos o que e' >= cutoff.
CUTOFF = ENV.get("DASHBOARD_CUTOFF", "2026-01-01")

DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "embaixadores.db"
JSON_PATH = DATA_DIR / "data.json"

# --- Pipedrive: IDs validados ao vivo (ver memoria pipedrive-integration) ---
PIPE_EMBAIXADOR = 45
STAGE_ATIVADOS = 324
STAGE_INATIVOS = 305
STAGE_NAMES = {
    301: "Qualificado", 302: "Contato Realizado", 303: "Demonstracao Agendada",
    304: "Negociacao", 306: "Onboarding", 324: "Ativados", 305: "Inativos",
}
MODEL_LABELS = {1218: "Subsidio", 1219: "Comissao", 1220: "Permuta"}

# Campos custom de deal (chaves reais da API)
CF_DATA_CRIACAO = "fbb0f103f1f5ddecd0f4ca8aa295ad7ca585c49b"
CF_ORIGEM_LEAD = "b64dde3fcd56acf9c7fe1a110179952ed5ccf1ae"
CF_GRUPO_ORIGEM = "941b405cdc07260c5945902a102c153e07c7429b"
CF_ABORDAGEM = "2825da1716b949d48c4a4ea3321e715de4b20a24"

# Opcoes de origem -> programa (para desempate quando referred_program vem vazio)
ORIGEM_EMBAIXADOR = {1134, 723, 884, 1103}
ORIGEM_PARCEIRO = {1135, 722, 886, 583, 111}
ORIGEM_CS = {950, 858, 951, 883, 1159, 1136, 266, 429, 1158}
ORIGEM_INDIQUE = {721, 885, 579}
