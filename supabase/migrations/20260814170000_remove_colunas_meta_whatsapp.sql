-- Remove as credenciais da WhatsApp Cloud API da Meta.
--
-- A integracao com a Meta saiu do codigo junto com a edge function
-- whatsapp-webhook. O envio e o recebimento sao inteiramente BubbleWhats, cujo
-- device e token vem de variaveis de ambiente das edge functions, nunca desta
-- tabela. Nenhuma linha de codigo le ou escreve estas colunas.
--
-- Alem de codigo morto, access_token e app_secret guardam credenciais da Meta em
-- texto na tabela — motivo a mais para nao deixa-las paradas ai.
--
-- Sobram em whatsapp_config apenas id, updated_at e o par last_error_at /
-- last_error_message, que continua em uso por bubblewhats-status e monica-core.

ALTER TABLE public.whatsapp_config
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS phone_number_id,
  DROP COLUMN IF EXISTS waba_id,
  DROP COLUMN IF EXISTS verify_token,
  DROP COLUMN IF EXISTS app_secret,
  DROP COLUMN IF EXISTS enabled;

-- Limpa o alerta antigo herdado da versao anterior do bubblewhats-status, que
-- gravava a falha mas nunca a apagava quando a sessao voltava.
UPDATE public.whatsapp_config
   SET last_error_at = NULL, last_error_message = NULL
 WHERE last_error_message ILIKE '%bubblewhats%';
