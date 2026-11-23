-- PULSE adds its own tables and policies only. Existing applications are untouched.
create schema if not exists pulse_private;
revoke all on schema pulse_private from public, anon, authenticated;
grant usage on schema pulse_private to service_role;

create table public.pulse_monitors (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 60),
 url text not null check (char_length(url)<=2048 and url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.(github\.io|onrender\.com|pages\.dev|vercel\.app|netlify\.app)(/[^?#[:space:]]*)?$'),
 enabled boolean not null default true,
 points jsonb not null default '[]'::jsonb check (jsonb_typeof(points)='array' and jsonb_array_length(points)<=288),
 last_checked_at timestamptz,
 created_at timestamptz not null default now(),
 unique(owner_id,url)
);
create index pulse_monitors_owner_idx on public.pulse_monitors(owner_id);
create index pulse_monitors_due_idx on public.pulse_monitors(last_checked_at nulls first) where enabled;
alter table public.pulse_monitors enable row level security;
revoke all on public.pulse_monitors from anon,authenticated;
grant select,delete on public.pulse_monitors to authenticated;
grant insert(name,url,enabled) on public.pulse_monitors to authenticated;
grant update(name,url,enabled) on public.pulse_monitors to authenticated;
grant all on public.pulse_monitors to service_role;
create policy pulse_read_own on public.pulse_monitors for select to authenticated using ((select auth.uid())=owner_id);
create policy pulse_insert_own on public.pulse_monitors for insert to authenticated with check ((select auth.uid())=owner_id and not coalesce((select auth.jwt())->>'is_anonymous','false')::boolean);
create policy pulse_update_own on public.pulse_monitors for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy pulse_delete_own on public.pulse_monitors for delete to authenticated using ((select auth.uid())=owner_id);

create function pulse_private.monitor_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,812));
  if (select count(*) from public.pulse_monitors where owner_id=new.owner_id)>=10 then
   raise exception '監視対象は1人10件までです';
  end if;
 elsif new.url is distinct from old.url then
  new.points='[]'::jsonb;
  new.last_checked_at=null;
 elsif new.enabled and not old.enabled then
  new.last_checked_at=null;
 end if;
 return new;
end $$;
create trigger pulse_monitor_guard before insert or update on public.pulse_monitors for each row execute function pulse_private.monitor_guard();
revoke all on function pulse_private.monitor_guard() from public;

create table pulse_private.worker_state (id boolean primary key default true check(id), token_hash text not null, busy_until timestamptz not null default '-infinity');
grant select,update on pulse_private.worker_state to service_role;

create function public.pulse_worker_batch(p_token text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(812812812);
 if not exists(select 1 from pulse_private.worker_state where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if exists(select 1 from pulse_private.worker_state where busy_until>now()) then return '[]'::jsonb; end if;
 update pulse_private.worker_state set busy_until=now()+interval '4 minutes' where id=true;
 select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into result from (
  select id,url from public.pulse_monitors where enabled and (last_checked_at is null or last_checked_at<now()-interval '4 minutes')
  order by last_checked_at nulls first,created_at limit 40
 ) m;
 return result;
end $$;
revoke all on function public.pulse_worker_batch(text) from public,anon,authenticated;
grant execute on function public.pulse_worker_batch(text) to service_role;

create function public.pulse_record_check(p_id uuid,p_url text,p_point jsonb) returns void language sql security invoker set search_path='' as $$
 update public.pulse_monitors m set
 points=(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from (select value,ord from jsonb_array_elements(m.points||jsonb_build_array(p_point)) with ordinality as e(value,ord) order by ord desc limit 288) recent),
 last_checked_at=(p_point->>'at')::timestamptz
 where id=p_id and url=p_url and enabled;
$$;
revoke all on function public.pulse_record_check(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pulse_record_check(uuid,text,jsonb) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ declare token text; begin
 token=encode(extensions.gen_random_bytes(32),'hex');
 perform vault.create_secret(token,'pulse_cron_token','PULSE monitoring scheduler only');
 insert into pulse_private.worker_state(token_hash) values(encode(extensions.digest(token,'sha256'),'hex'));
end $$;
-- Scheduling is enabled after deploying the matching function.
