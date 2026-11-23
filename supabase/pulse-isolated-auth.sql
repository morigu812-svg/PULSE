-- PULSE-only accounts. Does not modify auth.users or My-Links.
create table pulse_private.accounts (
 id uuid primary key default gen_random_uuid(),
 email text unique not null check(email=lower(btrim(email)) and char_length(email)<=254),
 password_hash text not null,
 recovery_hash text not null,
 created_at timestamptz not null default now()
);
create table pulse_private.sessions (
 token_hash text primary key,
 account_id uuid not null references pulse_private.accounts(id) on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index pulse_sessions_account_idx on pulse_private.sessions(account_id);
create index pulse_sessions_expiry_idx on pulse_private.sessions(expires_at);
create table pulse_private.rate_limits(bucket_key text primary key,hits integer not null,window_end timestamptz not null);
create index pulse_rate_expiry_idx on pulse_private.rate_limits(window_end);
create table pulse_private.auth_settings(id boolean primary key check(id),dummy_hash text not null);
insert into pulse_private.auth_settings values(true,extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',12)));
create table pulse_private.monitors (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references pulse_private.accounts(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 60),
 url text not null check(char_length(url)<=2048 and url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.(github\.io|onrender\.com|pages\.dev|vercel\.app|netlify\.app)(/[^?#[:space:]]*)?$'),
 enabled boolean not null default true,
 points jsonb not null default '[]'::jsonb check(jsonb_typeof(points)='array' and jsonb_array_length(points)<=288),
 last_checked_at timestamptz,
 created_at timestamptz not null default now(),
 unique(owner_id,url)
);
create index pulse_v2_due_idx on pulse_private.monitors(last_checked_at nulls first) where enabled;
alter table pulse_private.accounts enable row level security;
alter table pulse_private.sessions enable row level security;
alter table pulse_private.rate_limits enable row level security;
alter table pulse_private.auth_settings enable row level security;
alter table pulse_private.monitors enable row level security;
revoke all on all tables in schema pulse_private from public,anon,authenticated;
grant select,insert,update,delete on pulse_private.accounts,pulse_private.sessions,pulse_private.rate_limits,pulse_private.monitors to service_role;
grant select on pulse_private.auth_settings to service_role;

create function pulse_private.consume_rate(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_hits integer;
begin
 insert into pulse_private.rate_limits as r(bucket_key,hits,window_end)
 values(p_key,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket_key) do update set
 hits=case when r.window_end<=now() then 1 else r.hits+1 end,
 window_end=case when r.window_end<=now() then excluded.window_end else r.window_end end
 where r.bucket_key=excluded.bucket_key returning hits into v_hits;
 return v_hits<=p_limit;
end $$;
revoke all on function pulse_private.consume_rate(text,integer,integer) from public,anon,authenticated;
grant execute on function pulse_private.consume_rate(text,integer,integer) to service_role;

create function public.pulse_isolated_api(p_action text,p_input jsonb,p_token text,p_ip text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_email text:=lower(btrim(coalesce(p_input->>'email','')));
 v_password text:=coalesce(p_input->>'password','');
 v_account pulse_private.accounts%rowtype;
 v_id uuid; v_monitor pulse_private.monitors%rowtype;
 v_token text;v_recovery text;v_hash text;v_result jsonb;
 v_expires timestamptz:=now()+interval '7 days';
begin
 if not pulse_private.consume_rate('ip:'||encode(extensions.digest(left(coalesce(p_ip,'unknown'),200),'sha256'),'hex'),180,60) then
  return jsonb_build_object('status',429,'error','操作が集中しています。少し待ってからお試しください。','code','rate_limited');
 end if;
 delete from pulse_private.rate_limits where window_end<now()-interval '1 day';
 delete from pulse_private.sessions where expires_at<now();
 if p_action='health' then return jsonb_build_object('status',200,'ok',true,'auth','pulse-isolated'); end if;

 if p_action in ('signup','login','recover') then
  if char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_password) not between 8 and 128 then
   return jsonb_build_object('status',400,'error','メールアドレスと8〜128文字のパスワードを入力してください。','code','invalid_input');
  end if;
  if not pulse_private.consume_rate('email:'||encode(extensions.digest(v_email,'sha256'),'hex'),10,900) then
   return jsonb_build_object('status',429,'error','このアカウントでの試行回数が多いため、15分ほど待ってください。','code','rate_limited');
  end if;
  -- SHA-256 prehash avoids bcrypt truncation of long Unicode passwords.
  v_hash:=encode(extensions.digest(v_password,'sha256'),'hex');
  if p_action='signup' then
   if not pulse_private.consume_rate('signup:global',100,3600) then
    return jsonb_build_object('status',429,'error','新規登録が集中しています。後ほどお試しください。','code','rate_limited');
   end if;
   perform pg_advisory_xact_lock(hashtextextended(v_email,813));
   if exists(select 1 from pulse_private.accounts where email=v_email) then
    return jsonb_build_object('status',409,'error','PULSEに登録済みです。「ログイン」からお入りください。','code','pulse_account_exists');
   end if;
   v_recovery:=encode(extensions.gen_random_bytes(16),'hex');
   insert into pulse_private.accounts(email,password_hash,recovery_hash)
   values(v_email,extensions.crypt(v_hash,extensions.gen_salt('bf',12)),encode(extensions.digest(v_recovery,'sha256'),'hex')) returning * into v_account;
  elsif p_action='login' then
   select * into v_account from pulse_private.accounts where email=v_email for update;
   if extensions.crypt(v_hash,coalesce(v_account.password_hash,(select dummy_hash from pulse_private.auth_settings where id=true))) is distinct from v_account.password_hash or v_account.id is null then
    return jsonb_build_object('status',401,'error','PULSEのメールアドレスまたはパスワードを確認してください。My-Linksのアカウントとは別に新規登録が必要です。','code','invalid_credentials');
   end if;
  else
   select * into v_account from pulse_private.accounts where email=v_email for update;
   if v_account.id is null or v_account.recovery_hash is distinct from encode(extensions.digest(lower(btrim(coalesce(p_input->>'recovery_code',''))),'sha256'),'hex') then
    return jsonb_build_object('status',401,'error','メールアドレスまたは復旧コードを確認してください。','code','invalid_recovery');
   end if;
   v_recovery:=encode(extensions.gen_random_bytes(16),'hex');
   update pulse_private.accounts set password_hash=extensions.crypt(v_hash,extensions.gen_salt('bf',12)),recovery_hash=encode(extensions.digest(v_recovery,'sha256'),'hex') where id=v_account.id;
   delete from pulse_private.sessions where account_id=v_account.id;
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into pulse_private.sessions(token_hash,account_id,expires_at) values(encode(extensions.digest(v_token,'sha256'),'hex'),v_account.id,v_expires);
  return jsonb_build_object('status',200,'access_token',v_token,'expires_in',604800,'user',jsonb_build_object('id',v_account.id,'email',v_account.email),'recovery_code',v_recovery);
 end if;

 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('status',401,'error','PULSEにログインしてください。','code','session_expired');
 end if;
 select a.* into v_account from pulse_private.sessions s join pulse_private.accounts a on a.id=s.account_id
 where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>now();
 if v_account.id is null then return jsonb_build_object('status',401,'error','ログインの有効期限が切れました。','code','session_expired'); end if;
 if p_action='me' then return jsonb_build_object('status',200,'user',jsonb_build_object('id',v_account.id,'email',v_account.email)); end if;
 if p_action='logout' then
  delete from pulse_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  return jsonb_build_object('status',200,'ok',true);
 end if;
 if p_action='renew_recovery' then
  if not pulse_private.consume_rate('renew:'||v_account.id::text,5,900) then
   return jsonb_build_object('status',429,'error','試行回数が多いため、15分ほど待ってください。','code','rate_limited');
  end if;
  select * into v_account from pulse_private.accounts where id=v_account.id for update;
  if char_length(v_password) not between 8 and 128 or extensions.crypt(encode(extensions.digest(v_password,'sha256'),'hex'),v_account.password_hash) is distinct from v_account.password_hash then
   return jsonb_build_object('status',401,'error','PULSEのパスワードを確認してください。','code','invalid_password');
  end if;
  v_recovery:=encode(extensions.gen_random_bytes(16),'hex');
  update pulse_private.accounts set recovery_hash=encode(extensions.digest(v_recovery,'sha256'),'hex') where id=v_account.id;
  return jsonb_build_object('status',200,'recovery_code',v_recovery);
 end if;
 if p_action='list_monitors' then
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at),'[]'::jsonb) into v_result from pulse_private.monitors m where owner_id=v_account.id;
  return jsonb_build_object('status',200,'monitors',v_result);
 end if;
 if p_action in ('save_monitor','delete_monitor') then
  perform pg_advisory_xact_lock(hashtextextended(v_account.id::text,814));
  begin v_id:=nullif(p_input->>'id','')::uuid; exception when invalid_text_representation then
   return jsonb_build_object('status',400,'error','サイトIDが不正です。','code','invalid_id'); end;
  if v_id is not null then
   select * into v_monitor from pulse_private.monitors where id=v_id and owner_id=v_account.id for update;
   if not found then return jsonb_build_object('status',404,'error','監視対象が見つかりません。','code','not_found'); end if;
  end if;
  if p_action='delete_monitor' then
   if v_id is null then return jsonb_build_object('status',400,'error','サイトIDが必要です。','code','invalid_id'); end if;
   delete from pulse_private.monitors where id=v_id and owner_id=v_account.id;
   return jsonb_build_object('status',200,'ok',true);
  end if;
  if v_id is null then
   if (select count(*) from pulse_private.monitors where owner_id=v_account.id)>=10 then return jsonb_build_object('status',400,'error','監視対象は1人10件までです。','code','monitor_limit'); end if;
   v_monitor.id:=gen_random_uuid();v_monitor.owner_id:=v_account.id;v_monitor.points:='[]';v_monitor.enabled:=true;
  end if;
  if p_input ? 'name' then v_monitor.name:=btrim(p_input->>'name'); end if;
  if p_input ? 'url' then
   if (p_input->>'url') is distinct from v_monitor.url then v_monitor.points:='[]';v_monitor.last_checked_at:=null; end if;
   v_monitor.url:=p_input->>'url';
  end if;
  if p_input ? 'enabled' then
   if jsonb_typeof(p_input->'enabled')<>'boolean' then return jsonb_build_object('status',400,'error','監視設定が不正です。','code','invalid_input'); end if;
   if (p_input->>'enabled')::boolean and not v_monitor.enabled then v_monitor.last_checked_at:=null; end if;
   v_monitor.enabled:=(p_input->>'enabled')::boolean;
  end if;
  begin
   if v_id is null then
    insert into pulse_private.monitors(id,owner_id,name,url,enabled) values(v_monitor.id,v_account.id,v_monitor.name,v_monitor.url,v_monitor.enabled) returning * into v_monitor;
   else
    update pulse_private.monitors set name=v_monitor.name,url=v_monitor.url,enabled=v_monitor.enabled,points=v_monitor.points,last_checked_at=v_monitor.last_checked_at where id=v_id and owner_id=v_account.id returning * into v_monitor;
   end if;
  exception when check_violation or not_null_violation then return jsonb_build_object('status',400,'error','サイト名と対応する公開HTTPS URLを入力してください。','code','invalid_monitor');
   when unique_violation then return jsonb_build_object('status',409,'error','このURLは登録済みです。','code','duplicate_monitor');
  end;
  return jsonb_build_object('status',200,'monitor',to_jsonb(v_monitor));
 end if;
 return jsonb_build_object('status',400,'error','未対応の操作です。','code','invalid_action');
end $$;
revoke all on function public.pulse_isolated_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.pulse_isolated_api(text,jsonb,text,text) to service_role;

-- Preserve legacy PULSE records while scheduling both versions.
create or replace function public.pulse_worker_batch(p_token text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(812812812);
 if not exists(select 1 from pulse_private.worker_state where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then raise exception 'Forbidden' using errcode='42501'; end if;
 if exists(select 1 from pulse_private.worker_state where busy_until>now()) then return '[]'::jsonb; end if;
 update pulse_private.worker_state set busy_until=now()+interval '4 minutes' where id=true;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'url',url)),'[]') into result from (
  select id,url,last_checked_at,created_at from public.pulse_monitors where enabled and (last_checked_at is null or last_checked_at<now()-interval '4 minutes')
  union all
  select id,url,last_checked_at,created_at from pulse_private.monitors where enabled and (last_checked_at is null or last_checked_at<now()-interval '4 minutes')
  order by last_checked_at nulls first,created_at limit 40
 ) m;
 return result;
end $$;
create or replace function public.pulse_record_check(p_id uuid,p_url text,p_point jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.pulse_monitors m set
 points=(select coalesce(jsonb_agg(value order by ord),'[]') from (select value,ord from jsonb_array_elements(m.points||jsonb_build_array(p_point)) with ordinality e(value,ord) order by ord desc limit 288) recent),
 last_checked_at=(p_point->>'at')::timestamptz where id=p_id and url=p_url and enabled;
 update pulse_private.monitors m set
 points=(select coalesce(jsonb_agg(value order by ord),'[]') from (select value,ord from jsonb_array_elements(m.points||jsonb_build_array(p_point)) with ordinality e(value,ord) order by ord desc limit 288) recent),
 last_checked_at=(p_point->>'at')::timestamptz where id=p_id and url=p_url and enabled;
end $$;
