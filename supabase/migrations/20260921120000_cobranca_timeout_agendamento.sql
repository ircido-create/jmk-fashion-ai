-- Agendamento da cobrança: espera até 2 minutos pela resposta da dunning-cron.
--
-- O padrão do pg_net é 5 segundos. A rodada leva bem mais que isso, então o
-- banco desistia da chamada no meio: as mensagens saíam, mas dunning_runs
-- ficava para sempre em "executando", sem total, falhas nem erros — o painel
-- perdia justamente a informação que a tabela existe para mostrar.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'jmk-dunning-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/dunning-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dunning-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dunning_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $cmd$
);
