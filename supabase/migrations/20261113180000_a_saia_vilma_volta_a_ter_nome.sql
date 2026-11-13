-- A descrição da SAIA VILMA começava com o nome de outra peça.
--
-- Na loja, quem abria a Saia Vilma lia "Saia Secretária, uma peça que combina
-- elegância e modernidade...". O texto descreve a peça certa (malha montaria
-- com elastano, a que está na foto), mas o nome na primeira palavra era o da
-- vizinha de prateleira — a Saia Secretaria, que está cadastrada sem descrição
-- nenhuma. Provavelmente o texto foi escrito para uma e colado na outra.
--
-- Aqui só o nome troca. O resto do texto fica como está, porque descreve a
-- peça que a cliente vê na foto.
DO $vilma$
DECLARE
  v_quantas  integer;
  v_id       uuid;
  v_antes    text;
  v_depois   text;
BEGIN
  SELECT count(*) INTO v_quantas FROM public.products WHERE name ILIKE '%VILMA%';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION 'Esperava uma única peça com VILMA no nome, achei %. Nada foi alterado.', v_quantas;
  END IF;

  SELECT id, description INTO v_id, v_antes
    FROM public.products WHERE name ILIKE '%VILMA%';

  IF v_antes IS NULL OR btrim(v_antes) = '' THEN
    RAISE NOTICE 'A SAIA VILMA está sem descrição. Nada a corrigir.';
    RETURN;
  END IF;

  IF v_antes !~* '^\s*Saia\s+Secret[áa]ria' THEN
    RAISE NOTICE 'A descrição não começa mais pelo nome errado. Nada foi alterado. Texto atual: %',
                 left(v_antes, 80);
    RETURN;
  END IF;

  v_depois := regexp_replace(v_antes, '^\s*Saia\s+Secret[áa]ria', 'Saia Vilma');

  UPDATE public.products SET description = v_depois WHERE id = v_id;

  -- confere no próprio banco, não na minha leitura
  SELECT description INTO v_antes FROM public.products WHERE id = v_id;
  IF v_antes !~* '^Saia Vilma' THEN
    RAISE EXCEPTION 'A troca não pegou. Texto gravado: %', left(v_antes, 80);
  END IF;

  RAISE NOTICE 'SAIA VILMA: descrição agora começa por "%".', left(v_antes, 60);
END
$vilma$;
