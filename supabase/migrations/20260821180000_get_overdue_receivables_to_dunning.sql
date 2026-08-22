-- Fonte das contas a cobrar na rodada de cobranca automatica.
--
-- A edge function dunning-cron passou a chamar esta RPC em 19/08, mas ela nunca
-- foi criada no banco. Como o erro da chamada era descartado (apenas
-- { data: overdue }), a rodada recebia nulo, o laco nao executava e a cobranca
-- terminava "com sucesso" tendo enviado zero — sem nada indicar o motivo. Foi o
-- que manteve as mensagens paradas.
--
-- A funcao devolve ja filtrado o que deve ser cobrado agora. Isso importa por
-- causa do p_limit: se a filtragem ficasse so na edge function, as vagas do
-- limite seriam gastas com titulos que ela descartaria em seguida, e menos gente
-- seria cobrada do que o limite permite. A edge function mantem as mesmas
-- verificacoes como rede de seguranca.
--
-- O formato do retorno acompanha o que a edge function le: colunas do titulo mais
-- uma coluna "customers" em JSON com name e phone, equivalente ao aninhamento que
-- o PostgREST produzia no select com join.

CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(
  p_today DATE DEFAULT CURRENT_DATE,
  p_limit INTEGER DEFAULT 50,
  -- Titulos vencidos ha mais que isto sao ignorados, para nao cobrar divida
  -- antiga repetidamente. Espelha a regra ja aplicada na edge function.
  p_max_dias_vencido INTEGER DEFAULT 60
)
RETURNS TABLE (
  id UUID,
  amount NUMERIC,
  due_date DATE,
  description TEXT,
  customer_id UUID,
  customers JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ar.id,
    ar.amount,
    ar.due_date,
    ar.description,
    ar.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM public.accounts_receivable ar
  JOIN public.customers c ON c.id = ar.customer_id
  WHERE ar.status = 'vencido'
    AND c.phone IS NOT NULL
    AND btrim(c.phone) <> ''
    AND ar.due_date < p_today
    AND ar.due_date >= p_today - p_max_dias_vencido
    -- Ja cobrado hoje: uma mensagem por titulo por dia.
    AND NOT EXISTS (
      SELECT 1 FROM public.dunning_logs dl
       WHERE dl.receivable_id = ar.id
         AND dl.sent_at >= p_today::timestamptz
    )
    -- Lista de silencio. Compara so os digitos, porque os telefones sao
    -- cadastrados em formatos diferentes nas duas tabelas.
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_blocked_contacts b
       WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
    )
  -- Mais antigos primeiro: se o limite cortar, corta os menos urgentes.
  ORDER BY ar.due_date ASC
  LIMIT p_limit;
$$;

-- Chamada apenas pela edge function, que usa a service role. Nao e exposta a
-- usuarios autenticados porque devolve nome e telefone de clientes.
REVOKE ALL ON FUNCTION public.get_overdue_receivables_to_dunning(DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_overdue_receivables_to_dunning(DATE, INTEGER, INTEGER) TO service_role;

-- Acelera o NOT EXISTS de "ja cobrado hoje", executado uma vez por titulo.
CREATE INDEX IF NOT EXISTS idx_dunning_logs_receivable_sent
  ON public.dunning_logs(receivable_id, sent_at DESC);
