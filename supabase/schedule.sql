-- Installed after the pulse-monitor function is deployed.
select cron.schedule('pulse-monitor-every-five-minutes','*/5 * * * *', $job$
 select net.http_post(
  url:='https://bskmgytpfhmjhrclcohf.supabase.co/functions/v1/pulse-monitor',
  headers:=jsonb_build_object('Content-Type','application/json','x-pulse-cron',
   (select decrypted_secret from vault.decrypted_secrets where name='pulse_cron_token')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
