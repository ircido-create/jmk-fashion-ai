-- Historico de execucoes da cobranca automatica.
--
-- Ate aqui, uma rodada que falhava nao deixava rastro em lugar nenhum alem do
-- console da edge function. Quando o BubbleWhats ficava fora do ar, a rodada
-- abortava inteira e ninguem no sistema ficava sabendo — so se percebia pela
-- ausencia das mensagens, dias depois.
--
-- dunning_logs registra mensagem ENVIADA; nao serve para isso, porque justamente
-- quando nada e enviado ela fica vazia e o silencio e indistinguivel de "nao havia
-- ninguem para cobrar".

CREATE TABLE public.dunning_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  -- 'sucesso' = rodada completou; 'falha' = abortou antes do fim.
  -- Uma rodada pode completar com falhas individuais: ver enviadas/falhadas.
  status TEXT NOT NULL DEFAULT 'executando',
  total INTEGER NOT NULL DEFAULT 0,
  enviadas INTEGER NOT NULL DEFAULT 0,
  falhadas INTEGER NOT NULL DEFAULT 0,
  -- Origem: 'cron' (agendamento) ou 'manual' (botao no painel).
  origem TEXT NOT NULL DEFAULT 'cron',
  erro TEXT
);

CREATE INDEX idx_dunning_runs_started ON public.dunning_runs(started_at DESC);

ALTER TABLE public.dunning_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.dunning_runs TO authenticated;
GRANT ALL ON public.dunning_runs TO service_role;

CREATE POLICY "Autenticados veem execucoes de cobranca"
ON public.dunning_runs FOR SELECT TO authenticated USING (true);
