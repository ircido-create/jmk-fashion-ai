-- Limpa da lista de comprovantes os que são repetição de outro já recebido.
--
-- Quando a cliente manda o mesmo comprovante duas vezes (ou reenvia um antigo
-- que o sistema já tinha lido), a baixa automática não repete o pagamento: ela
-- marca o segundo como 'pendente' com a nota "Comprovante repetido (mesmo ID
-- de transação já recebido)". Esses registros não servem para nada depois de
-- conferidos e só poluem a tela de comprovantes.
--
-- São 8, de 4 clientes, conferidos em 10/11/2026:
--     Cido                         06/11 12:52   R$ 1.209,30
--     Elissama Cazano              04/11 14:42   R$   576,00
--     Luzia de Sousa Brito Tomaz   10/11 17:09   R$   250,00
--     Luzia de Sousa Brito Tomaz   10/11 17:09   R$   250,00
--     Luzia de Sousa Brito Tomaz   10/11 17:09   R$   460,00
--     Luzia de Sousa Brito Tomaz   10/11 17:09   R$   250,00
--     Luzinete de Lima Fernandes   18/10 11:06   R$   350,00
--     Luzinete de Lima Fernandes   18/10 11:06   R$   350,00
--
-- Nenhum deles tem baixa ligada (receivable_payments), e de todos existe o
-- comprovante original, que fica. Ou seja: nada de dinheiro muda, nenhum
-- pagamento é desfeito e a trava contra repetição continua funcionando, porque
-- ela compara com o original.
--
-- As imagens continuam guardadas no bucket whatsapp-media — some só a linha da
-- lista de comprovantes.
--
-- Autorizado pelo José em 10/11/2026, ciente de que a exclusão é definitiva.
DO $repetidos$
DECLARE
  v_nota    text := 'Comprovante repetido (mesmo ID de transação já recebido)';
  v_qtd     int;
  v_ligados int;
  v_orfaos  int;
  v_sobrou  int;
BEGIN
  SELECT count(*) INTO v_qtd
    FROM public.payment_proofs WHERE settlement_note = v_nota;

  IF v_qtd <> 8 THEN
    RAISE EXCEPTION 'Esperava 8 comprovantes repetidos e achei % — confira a lista antes de apagar.', v_qtd;
  END IF;

  -- nenhum pode ter baixa ligada
  SELECT count(*) INTO v_ligados
    FROM public.payment_proofs pp
   WHERE pp.settlement_note = v_nota
     AND EXISTS (SELECT 1 FROM public.receivable_payments rp WHERE rp.proof_id = pp.id);

  IF v_ligados > 0 THEN
    RAISE EXCEPTION '% comprovante(s) repetido(s) têm baixa ligada. Não apago nada.', v_ligados;
  END IF;

  -- de todos tem de existir o original, fora desta lista
  SELECT count(*) INTO v_orfaos
    FROM public.payment_proofs pp
   WHERE pp.settlement_note = v_nota
     AND NOT EXISTS (
       SELECT 1 FROM public.payment_proofs o
        WHERE o.id <> pp.id
          AND lower(regexp_replace(coalesce(o.ai_transaction_id, ''), '\s', '', 'g'))
            = lower(regexp_replace(coalesce(pp.ai_transaction_id, ''), '\s', '', 'g'))
          AND coalesce(o.settlement_note, '') <> v_nota
     );

  IF v_orfaos > 0 THEN
    RAISE EXCEPTION '% comprovante(s) marcados como repetidos não têm original no sistema. Não apago nada.', v_orfaos;
  END IF;

  DELETE FROM public.payment_proofs WHERE settlement_note = v_nota;

  SELECT count(*) INTO v_sobrou
    FROM public.payment_proofs WHERE settlement_note = v_nota;

  IF v_sobrou <> 0 THEN
    RAISE EXCEPTION 'Sobraram % comprovantes repetidos depois da limpeza.', v_sobrou;
  END IF;
END
$repetidos$;
