# Corrigir "nenhum débito" na cobrança manual

## O que está acontecendo

A cobrança manual não encontra nada porque a peça do banco que ela consulta não existe.

Verificado agora no banco:
- Existem **97 títulos vencidos**, sendo **44 elegíveis** (cliente com telefone e vencimento nos últimos 60 dias).
- A função de banco `get_overdue_receivables_to_dunning`, que o botão usa para buscar esses títulos, **não existe**.
- A tabela `dunning_runs`, usada para registrar cada execução no painel, **também não existe**.
- Último envio registrado em `dunning_logs`: 19/08/2026. Nenhum envio hoje.

Sem a função, a busca volta vazia e a tela conclui "nenhum novo débito pendente de cobrança".

## O que será feito

1. Criar a função de banco `get_overdue_receivables_to_dunning(p_today, p_limit)`, retornando os títulos vencidos com cliente e telefone, mais antigos primeiro, ignorando:
   - títulos já cobrados hoje (`dunning_logs`),
   - contatos na lista de silêncio (`ai_blocked_contacts`),
   - vencimentos com mais de 60 dias de atraso.
2. Criar a tabela `dunning_runs` (origem, status, total, enviadas, falhadas, erro, início/fim) com RLS e GRANTs, para o painel mostrar o resultado de cada rodada.
3. Reexecutar a cobrança manual e conferir quantas mensagens saíram de fato.

## Detalhes técnicos

- Função `SECURITY DEFINER`, `SET search_path = public`, `STABLE`, retornando `id, customer_id, amount, due_date, description, customer_name, customer_phone`. O código da edge function lê `r.customers.name/phone`, então a função devolverá esses campos aninhados em JSON (ou a edge function será ajustada para ler as colunas planas — o que exigir menos mudança).
- `dunning_runs`: leitura para `authenticated`, escrita apenas via `service_role` (a edge function usa service role).
- Nenhuma mudança de layout; apenas o painel de cobrança passa a exibir dados reais.
