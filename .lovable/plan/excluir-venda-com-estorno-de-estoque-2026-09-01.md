# Excluir venda com estorno de estoque

## O que muda

Na página **Vendas**, cada venda ganha um botão **Excluir venda** (ícone de lixeira, em vermelho).

Ao clicar, abre uma confirmação mostrando cliente, valor, itens e o que será feito:

- As peças da venda voltam para o estoque (quantidade estornada por variação).
- As parcelas em aberto (contas a receber) geradas por essa venda são removidas.
- A venda e seus itens são apagados.

## Trava de segurança

Se a venda tiver **qualquer pagamento registrado** — parcela com status "pago" ou comprovante vinculado a uma conta a receber da venda — a exclusão é **bloqueada**. O diálogo mostra a mensagem: "Não é possível excluir: existem pagamentos registrados para esta venda. Estorne os pagamentos antes." e o botão de confirmar fica desabilitado.

A verificação usa a mesma lógica já existente na tela de alterar forma de pagamento (parcelas ligadas à venda por `receivable_id` ou pela descrição "venda XXXXXXXX", cruzadas com a tabela de pagamentos).

## Detalhes técnicos

- Nova função no banco `increment_variant_stock(variant_id uuid, qty int)` (security definer), espelhando a `decrement_variant_stock` existente.
- Em `src/pages/Sales.tsx`:
  - `openDeleteSale(s)` reaproveita `loadSaleReceivables` para carregar parcelas abertas/pagas antes de habilitar a confirmação.
  - `confirmDeleteSale()` executa, na ordem: estorno de estoque para cada `sale_item` com `variant_id` (via RPC), delete das contas a receber em aberto da venda, delete de `sale_items`, delete de `sales`, depois recarrega a lista.
  - Itens sem `variant_id` (produto avulso) não geram estorno de estoque — informado no diálogo.
- Toast de sucesso resumindo peças estornadas e parcelas removidas.
