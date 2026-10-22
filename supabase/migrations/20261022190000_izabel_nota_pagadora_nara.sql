-- IZABEL CRISTINA CARVALHO DOS REIS: quem paga as parcelas é a Nara Costa Lima.
--
-- Dois Pix dela caíram nesta conta — 30/09/2026 (R$ 400,00) e 22/10/2026
-- (R$ 500,00) — e o nome no comprovante não bate com o cadastro, então a
-- conferência depende de alguém lembrar disso. A Nara não tem cadastro próprio
-- na loja. A nota fica no cadastro para o próximo comprovante dela não travar.
UPDATE public.customers
   SET notes = 'Parte das parcelas é paga por NARA COSTA LIMA: comprovantes de 30/09/2026 (R$ 400,00) e 22/10/2026 (R$ 500,00) vieram no nome dela. A Nara não tem cadastro próprio.'
 WHERE name = 'IZABEL CRISTINA CARVALHO DOS REIS'
   AND coalesce(btrim(notes), '') = '';
