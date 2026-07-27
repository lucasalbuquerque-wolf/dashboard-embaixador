-- =====================================================================
-- ENDURECIMENTO DO RLS (auditoria C3) — rode ANTES do deploy público.
-- Hoje as policies são `to authenticated using (true)`: QUALQUER conta
-- autenticada lê TODA a base de PII. Se o signup do Supabase estiver
-- ligado, qualquer um se cadastra e lê tudo.
--
-- PASSO 1 (painel, obrigatório): Authentication > Providers/Settings >
--   DESABILITAR "Allow new users to sign up". Criar usuários por convite.
--
-- PASSO 2 (opcional, recomendado): trocar `using(true)` por allowlist de
--   e-mails abaixo, para não depender só da config de signup.
--   COLE no SQL Editor e rode. Edite a lista de e-mails autorizados.
-- =====================================================================

create table if not exists authorized_users (
    email text primary key,
    added_at timestamptz default now()
);

-- >>> E-mails que podem ler o dashboard <<<
insert into authorized_users (email) values
    ('lucas.albuquerque@umbler.com'),
    ('marcos@umbler.com'),
    ('victor.fraga@umbler.com')
on conflict (email) do nothing;

alter table authorized_users enable row level security;
drop policy if exists "auth read authorized_users" on authorized_users;
create policy "auth read authorized_users" on authorized_users
    for select to authenticated using ((auth.jwt() ->> 'email') = email);

-- Helper: o e-mail do usuário logado está na allowlist?
create or replace function is_authorized() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from authorized_users where email = (auth.jwt() ->> 'email'));
$$;

-- Repõe as policies de leitura escopadas pela allowlist.
do $$
declare t text;
begin
  foreach t in array array['ambassadors','referrers','clients','leads','snapshots'] loop
    execute format('drop policy if exists "auth read %1$s" on %1$s', t);
    execute format('create policy "auth read %1$s" on %1$s for select to authenticated using (is_authorized())', t);
  end loop;
end $$;

-- Para reverter ao comportamento antigo (qualquer autenticado):
--   create policy "auth read <tabela>" on <tabela> for select to authenticated using (true);
