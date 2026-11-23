begin;
select set_config('pulse.test_a',gen_random_uuid()::text,true),set_config('pulse.test_b',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('pulse.test_a')::uuid,'pulse-test-a-'||current_setting('pulse.test_a')||'@example.invalid'),(current_setting('pulse.test_b')::uuid,'pulse-test-b-'||current_setting('pulse.test_b')||'@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('pulse.test_a'),'role','authenticated','is_anonymous',false)::text,true);
insert into public.pulse_monitors(name,url) values('Owner A','https://pulse-test.onrender.com/');
do $$begin
 if (select count(*) from public.pulse_monitors)<>1 then raise exception 'Owner A visibility failed'; end if;
 begin
  update public.pulse_monitors set points='[{"ok":true}]';
  raise exception 'Result forgery was allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.pulse_monitors set owner_id=current_setting('pulse.test_b')::uuid;
  raise exception 'Ownership reassignment was allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pulse_worker_batch(repeat('a',64));
  raise exception 'Worker callable by visitor';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('pulse.test_b'),'role','authenticated','is_anonymous',false)::text,true);
do $$begin
 if (select count(*) from public.pulse_monitors)<>0 then raise exception 'Cross-user read allowed'; end if;
 update public.pulse_monitors set name='hijacked';
 if found then raise exception 'Cross-user edit allowed'; end if;
 delete from public.pulse_monitors;
 if found then raise exception 'Cross-user delete allowed'; end if;
end $$;
insert into public.pulse_monitors(name,url) select 'B-'||i,'https://pulse-test.onrender.com/'||i from generate_series(1,10) i;
do $$begin
 begin
  insert into public.pulse_monitors(name,url) values('Limit','https://pulse-test.onrender.com/11');
  raise exception 'Monitor limit bypassed';
 exception when raise_exception then
  if SQLERRM not like '%10件%' then raise; end if;
 end;
end $$;
reset role;
rollback;
select 'PASS: owner isolation, forgery denial, worker isolation, ten-site limit; all test data rolled back' as test_result;
