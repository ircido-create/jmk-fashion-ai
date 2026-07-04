## Objetivo
Na tela de detalhes do cliente, substituir o card "Pendentes no prazo" do score de confiança para mostrar o valor total da dívida (saldo em aberto).

## O que será feito
1. Em `src/pages/CustomerDetail.tsx`, calcular o valor total em aberto somando `amount` das parcelas pendentes (status diferente de `pago` e `cancelado`).
2. Trocar o card "Pendentes no prazo" por "Saldo em aberto" exibindo o valor formatado em reais (R$).
3. Manter os demais cards (Pagos em dia, Pagos em atraso, Em aberto vencidos) inalterados.
4. Garantir que o valor seja recalculado automaticamente quando as parcelas forem atualizadas.

## Resultado esperado
Ao selecionar um cliente, o usuário verá o valor total da dívida em destaque no painel de confiança, no lugar do antigo número de pendentes no prazo.