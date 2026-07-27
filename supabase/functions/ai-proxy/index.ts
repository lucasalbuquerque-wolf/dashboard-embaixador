// Proxy server-side da Anthropic (auditoria C3 / A9).
// A chave da Anthropic fica AQUI (variável de ambiente do servidor), nunca no bundle do frontend.
// O frontend chama esta função com o token da sessão Supabase; validamos o usuário e repassamos.
//
// Deploy:
//   supabase functions deploy ai-proxy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # NUNCA prefixe com VITE_
// Depois, no dashboard/.env.local (ou no painel do Vercel):
//   VITE_AI_PROXY_URL=https://<PROJECT_REF>.functions.supabase.co/ai-proxy
//   (e deixe VITE_ANTHROPIC_API_KEY VAZIO em produção)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // 1) Autenticação: exige um usuário Supabase válido (a mesma sessão do dashboard).
  const authHeader = req.headers.get('authorization') || ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { authorization: authHeader } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  // (Opcional) allowlist: descomente para restringir a e-mails específicos.
  // const allow = (Deno.env.get('AI_ALLOWED_EMAILS') || '').split(',').map((s) => s.trim())
  // if (allow.length && !allow.includes(user.email ?? '')) return json({ error: 'forbidden' }, 403)

  // 2) Repassa o corpo para a Anthropic com a chave do SERVIDOR.
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }, 500)
  const body = await req.text()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body,
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}
