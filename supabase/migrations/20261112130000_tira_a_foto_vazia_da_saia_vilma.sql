-- Tira da SAIA VILMA a foto que subiu vazia.
--
-- Em 12/11/2026, às 08:25, a foto da SAIA VILMA subiu com 0 byte
-- (product-images/1794482756125_fqx5zgj3gui.jpeg). O arquivo ficou gravado, a
-- URL respondia HTTP 200 com content-type image/jpeg, e por isso a peça passou
-- pelo filtro da vitrine — que só exige que exista uma foto. Resultado: card
-- preto na loja, com o nome e o preço e nenhuma imagem.
--
-- A trava para não acontecer de novo está no código (src/lib/fotoEnviada.ts,
-- commit f80badd). Aqui some o estrago que já estava feito.
--
-- O QUE MUDA. A referência sai da peça e o arquivo vazio sai do bucket. A SAIA
-- VILMA deixa de aparecer na loja até o José subir a foto de novo — melhor um
-- card a menos do que um card preto. Nada mais é tocado: preço, estoque, a
-- chave "Mostrar na loja" e a peça no estoque ficam como estão.
--
-- Autorizado pelo José em 12/11/2026.
DO $vazia$
DECLARE
  v_arquivo text := '1794482756125_fqx5zgj3gui.jpeg';
  v_bytes   bigint;
  v_usos    int;
  v_prod    uuid;
  v_nome    text;
  v_sobrou  int;
BEGIN
  -- 1. é mesmo o arquivo vazio?
  SELECT coalesce((o.metadata->>'size')::bigint, -1) INTO v_bytes
    FROM storage.objects o
   WHERE o.bucket_id = 'product-images' AND o.name = v_arquivo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não achei o arquivo % no bucket product-images.', v_arquivo;
  END IF;

  IF v_bytes <> 0 THEN
    RAISE EXCEPTION 'O arquivo % tem % bytes — não é o vazio. Não apago nada.', v_arquivo, v_bytes;
  END IF;

  -- 2. quem usa esse arquivo
  SELECT count(*) INTO v_usos
    FROM products p
   WHERE p.image_url LIKE '%' || v_arquivo
      OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo);

  IF v_usos <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 peça usando a foto vazia e achei % — confira antes.', v_usos;
  END IF;

  SELECT p.id, p.name INTO v_prod, v_nome
    FROM products p
   WHERE p.image_url LIKE '%' || v_arquivo
      OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo);

  IF v_nome NOT ILIKE '%VILMA%' THEN
    RAISE EXCEPTION 'A foto vazia está na peça "%", que não é a SAIA VILMA. Parei.', v_nome;
  END IF;

  IF EXISTS (SELECT 1 FROM product_variants v
              WHERE v.image_url LIKE '%' || v_arquivo) THEN
    RAISE EXCEPTION 'A foto vazia também está numa variação — não previsto, parei.';
  END IF;

  -- 3. tira a referência
  UPDATE products
     SET image_url = CASE WHEN image_url LIKE '%' || v_arquivo THEN NULL ELSE image_url END,
         images = coalesce((SELECT array_agg(img ORDER BY ord)
                              FROM unnest(images) WITH ORDINALITY AS t(img, ord)
                             WHERE img NOT LIKE '%' || v_arquivo), '{}'::text[]),
         updated_at = now()
   WHERE id = v_prod;

  -- 4. tira o arquivo vazio do bucket
  DELETE FROM storage.objects
   WHERE bucket_id = 'product-images' AND name = v_arquivo;

  -- 5. conferências
  IF EXISTS (SELECT 1 FROM products p
              WHERE p.id = v_prod
                AND (p.image_url LIKE '%' || v_arquivo
                  OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo))) THEN
    RAISE EXCEPTION 'A referência da foto vazia continua na peça.';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.objects
              WHERE bucket_id = 'product-images' AND name = v_arquivo) THEN
    RAISE EXCEPTION 'O arquivo vazio continua no bucket.';
  END IF;

  IF EXISTS (SELECT 1 FROM store_catalog() c WHERE c.id = v_prod) THEN
    RAISE EXCEPTION 'A peça continua na vitrine mesmo sem foto — confira store_catalog.';
  END IF;

  SELECT count(*) INTO v_sobrou
    FROM storage.objects
   WHERE bucket_id = 'product-images'
     AND coalesce((metadata->>'size')::bigint, 0) = 0;

  IF v_sobrou > 0 THEN
    RAISE EXCEPTION 'Ainda há % foto(s) vazia(s) no bucket.', v_sobrou;
  END IF;

  RAISE NOTICE 'Foto vazia removida de "%". A peça sai da vitrine até a foto nova subir.', v_nome;
END
$vazia$;
