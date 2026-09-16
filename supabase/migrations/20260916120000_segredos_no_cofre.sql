-- Segredos internos no cofre do banco (Supabase Vault).
--
-- Em 14/09 as edge functions foram republicadas com o endurecimento de 21/08 e
-- 01/09, que exige BUBBLEWHATS_WEBHOOK_SECRET e DUNNING_SECRET. Nenhum dos dois
-- estava cadastrado: o webhook passou a recusar toda mensagem do BubbleWhats e a
-- cobrança automática parou.
--
-- Os valores nascem aqui, aleatórios, e nunca passam por tela, chat ou arquivo:
-- as funções leem pelo get_internal_secret (só service_role) e o agendamento lê
-- direto do cofre. Se um dia o segredo for cadastrado nas variáveis da função,
-- ele tem prioridade (ver supabase/functions/_shared/secrets.ts).

-- 1) Segredos (só cria se ainda não existirem: reaplicar não troca o valor, o
--    que invalidaria a URL já registrada no BubbleWhats).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'bubblewhats_webhook_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'bubblewhats_webhook_secret',
      'Segredo do webhook do BubbleWhats (vai na URL como ?k=)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'dunning_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'dunning_secret',
      'Segredo do agendamento da cobrança automática (cabeçalho x-dunning-secret)');
  END IF;
END $$;

-- 2) Leitura pelas edge functions. Lista fechada de nomes e execução só para
--    service_role: nem visitante nem usuário logado alcança o cofre por aqui.
CREATE OR REPLACE FUNCTION public.get_internal_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF p_name NOT IN ('bubblewhats_webhook_secret', 'dunning_secret') THEN
    RAISE EXCEPTION 'segredo não permitido';
  END IF;
  RETURN (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_internal_secret(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_internal_secret(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_internal_secret(text) TO service_role;

-- 3) Agendamento da cobrança: manda o segredo do cofre e deixa de carregar um
--    token fixo no comando. A dunning-cron aceita o x-dunning-secret sozinho.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'jmk-dunning-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/dunning-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dunning-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dunning_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);
