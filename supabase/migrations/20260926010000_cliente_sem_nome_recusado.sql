-- Não gravar cliente sem nome de verdade.
--
-- A Mônica criava cadastro "(sem nome)" para qualquer número desconhecido que
-- mandasse algo parecido com endereço ou e-mail — até para grupos do WhatsApp.
-- A importação de parcelas usava "Cliente sem nome". Agora o banco recusa, em
-- qualquer tela ou função, nome vazio, marcador de "sem nome" ou nome que é só
-- número de telefone. Quem chama sem nome real simplesmente não cria o cadastro
-- (a Mônica já trata o retorno vazio e volta a perguntar o nome).
CREATE OR REPLACE FUNCTION public.reject_placeholder_customer_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v text := lower(btrim(coalesce(NEW.name, '')));
BEGIN
  -- Em alteração, só confere quando o nome muda (cadastros antigos continuam editáveis).
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;
  IF v = ''
     OR v IN ('?', '-', '.', 'sem nome', '(sem nome)', 'cliente sem nome', 'cliente', 'desconhecido', 'desconhecida')
     OR v ~ '^\+?[0-9\s().@-]+$'
     OR v LIKE '%@s.whatsapp.net' OR v LIKE '%@g.us'
  THEN
    RAISE EXCEPTION 'Cliente sem nome não pode ser gravado (nome recebido: "%"). Informe o nome da cliente.', coalesce(NEW.name, '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_placeholder_customer_name ON public.customers;
CREATE TRIGGER trg_reject_placeholder_customer_name
  BEFORE INSERT OR UPDATE OF name ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.reject_placeholder_customer_name();
