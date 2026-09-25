-- Parcela com pagamento registrado não pode ser excluída.
--
-- A tela de Contas a Receber tinha essa trava, mas descobria os pagamentos numa
-- consulta com o id de TODAS as parcelas; acima de ~700 parcelas o servidor
-- recusa a consulta (400), a tela ignorava o erro e a trava deixava de valer.
-- Assim sumiram a 2/5 da CONSTANCIA e a 4/7 da BEATRIZ, levando junto (cascata)
-- o registro do pagamento. Agora quem recusa é o banco, venha de qualquer tela.
-- Para excluir, estorne antes o comprovante (reverse_payment_proof apaga os
-- vínculos e devolve o valor à parcela).
CREATE OR REPLACE FUNCTION public.block_delete_paid_receivable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.receivable_payments WHERE receivable_id = OLD.id) THEN
    RAISE EXCEPTION 'A parcela de % (vencimento %) tem pagamento registrado. Estorne o comprovante antes de excluir.',
      'R$ ' || replace(to_char(OLD.amount, 'FM9999999990.00'), '.', ','),
      to_char(OLD.due_date, 'DD/MM/YYYY');
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_delete_paid_receivable ON public.accounts_receivable;
CREATE TRIGGER trg_block_delete_paid_receivable
  BEFORE DELETE ON public.accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_paid_receivable();
