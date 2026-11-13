-- A SAIA VILMA volta a ter foto de capa.
--
-- Em 12/11/2026 a capa da peça saiu porque tinha subido com 0 byte
-- (migração 20261112130000). Desde então a peça só continua aparecendo na loja
-- por causa do COALESCE de store_catalog(), que cai na foto da variação
-- GG · TERRACOTA — 192 KB, boa. Na vitrine ficou bonito; no Estoque e no PDV,
-- que leem image_url/images direto, a peça ficou sem imagem nenhuma.
--
-- O QUE MUDA. A foto da variação passa a ser também a capa e a primeira da
-- galeria da peça. É a mesma imagem que a cliente já vê na loja hoje, então
-- nada muda para ela; muda para a equipe, que volta a enxergar a peça.
--
-- Nenhum arquivo novo é enviado e nada é apagado: só se aponta, na peça, para
-- uma foto que já existe no bucket. Quando o José subir uma capa melhor pelo
-- Estoque, ela substitui esta normalmente.
--
-- Autorizado pelo José em 13/11/2026.
DO $capa$
DECLARE
  v_prod   uuid;
  v_nome   text;
  v_foto   text;
  v_bytes  bigint;
  v_capa   text;
  v_vitrine text;
BEGIN
  -- 1. a peça
  SELECT p.id, p.name INTO v_prod, v_nome
    FROM products p
   WHERE p.name ILIKE '%VILMA%';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não achei a SAIA VILMA.';
  END IF;

  IF (SELECT count(*) FROM products p WHERE p.name ILIKE '%VILMA%') <> 1 THEN
    RAISE EXCEPTION 'Mais de uma peça com VILMA no nome — confira antes.';
  END IF;

  -- 2. só mexo se a capa estiver mesmo vazia, para não passar por cima de uma
  --    foto que o José já tenha subido.
  SELECT p.image_url INTO v_capa FROM products p WHERE p.id = v_prod;

  IF v_capa IS NOT NULL OR (SELECT coalesce(array_length(p.images, 1), 0) FROM products p WHERE p.id = v_prod) > 0 THEN
    RAISE NOTICE 'A peça "%" já tem foto de capa. Não mexi em nada.', v_nome;
    RETURN;
  END IF;

  -- 3. a foto da variação, que é a que a vitrine já mostra
  SELECT v.image_url INTO v_foto
    FROM product_variants v
   WHERE v.product_id = v_prod AND v.image_url IS NOT NULL
   ORDER BY v.quantity DESC, v.size
   LIMIT 1;

  IF v_foto IS NULL THEN
    RAISE EXCEPTION 'A peça "%" não tem foto em nenhuma variação — a capa precisa vir de um envio novo.', v_nome;
  END IF;

  -- 4. e ela não pode ser outra foto vazia
  SELECT coalesce((o.metadata->>'size')::bigint, -1) INTO v_bytes
    FROM storage.objects o
   WHERE o.bucket_id = 'product-images' AND v_foto LIKE '%' || o.name;

  IF coalesce(v_bytes, 0) <= 0 THEN
    RAISE EXCEPTION 'A foto da variação tem % bytes — não serve de capa.', coalesce(v_bytes, 0);
  END IF;

  -- 5. grava
  UPDATE products
     SET image_url  = v_foto,
         images     = ARRAY[v_foto],
         updated_at = now()
   WHERE id = v_prod;

  -- 6. conferências
  IF NOT EXISTS (SELECT 1 FROM products p
                  WHERE p.id = v_prod AND p.image_url = v_foto AND p.images = ARRAY[v_foto]) THEN
    RAISE EXCEPTION 'A capa não ficou gravada.';
  END IF;

  SELECT c.image_url INTO v_vitrine FROM store_catalog() c WHERE c.id = v_prod;

  IF v_vitrine IS DISTINCT FROM v_foto THEN
    RAISE EXCEPTION 'A vitrine devolveu "%" em vez da capa gravada.', coalesce(v_vitrine, '(nada)');
  END IF;

  RAISE NOTICE 'Capa da "%" gravada: % bytes. Vitrine conferida.', v_nome, v_bytes;
END
$capa$;
