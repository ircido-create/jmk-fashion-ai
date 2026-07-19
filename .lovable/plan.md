## Objetivo
Permitir alterar a forma de pagamento de uma venda já finalizada usando **Pagamento Misto** (várias formas somando o total), igual ao PDV — incluindo o caso da venda da **Lis Talita** (R$ 480, atualmente "fiado" 2x).

## Escopo
Somente `src/pages/Sales.tsx` — o diálogo "Alterar forma de pagamento". Sem mudanças de schema.

## Mudanças no diálogo (venda finalizada)

1. **Modo Misto (toggle)** dentro do diálogo:
   - Quando ativado, some o Select "Método" único.
   - Aparece uma lista de linhas `{ método, valor }` (PIX / Dinheiro / Crédito / Débito / Link / Fiado).
   - Botão **"+ Adicionar forma"**, botão de remover por linha.
   - Rodapé mostra `Somatório × Total da venda` e destaca em vermelho se diferente.
   - Valida no salvar: mínimo 2 linhas e soma = total (tolerância 0,01).

2. **Modo Simples** continua igual (um método + parcelas quando crédito/fiado).

3. **Persistência ao salvar**:
   - Simples: `sales.payment_method = método`, `installments` conforme regra atual.
   - Misto: `sales.payment_method = 'misto'`, `installments = 1`, e anexa/atualiza em `sales.notes` a linha `Misto: PIX R$ X + Dinheiro R$ Y + Fiado R$ Z` (removendo linha "Misto: ..." anterior, se houver, para evitar duplicar no reimprimir).
   - **Contas a receber**: se houver parte em **Fiado** no misto (ou método simples = fiado), oferecer campo **"Vencimento da parte fiado"** e criar 1 registro em `accounts_receivable` (mesma lógica do PDV para split). No modo simples fiado com parcelas, mantém geração N parcelas mensais. Um aviso curto explica: "Isso cria novas contas a receber; ajustes/quitações de contas antigas devem ser feitos manualmente em Contas a Receber."

4. **UX**: pré-preenche o modo Misto quando `payment_method === 'misto'` fazendo parse da nota `Misto: ...` para recuperar as linhas; se não conseguir, começa com 2 linhas em branco somando o total.

## Não incluso
- Não sincroniza/apaga automaticamente contas a receber já existentes da venda anterior (ex.: as 2 parcelas fiado da Lis Talita). O usuário decide se ajusta em Contas a Receber. Posso fazer isso em passo separado se quiser.

## Detalhes técnicos
- Reutiliza `PAYMENT_LABELS` e o mesmo tipo `PaymentMethod` de `POS.tsx` (importar ou replicar local).
- Novo state no `Sales.tsx`: `paySplitMode`, `paySplits: { method, amount }[]`, `payFiadoDueDate`.
- Função `savePayEdit` passa a lidar com os dois modos e o insert em `accounts_receivable` quando houver fiado.