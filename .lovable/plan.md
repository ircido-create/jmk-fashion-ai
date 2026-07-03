## Plano

1. **Corrigir baixa individual em Contas a Receber**
   - Quando o valor recebido for maior que a parcela selecionada, marcar a parcela atual como paga.
   - Usar automaticamente o excedente para abater as próximas parcelas pendentes/vencidas do mesmo cliente, da mais antiga para a mais nova.
   - Se o excedente quitar a próxima parcela inteira, marcar como paga; se for parcial, reduzir o valor restante da parcela.

2. **Corrigir recebimento no detalhe do cliente**
   - Aplicar a mesma regra na tela do cliente ao pagar parcelas selecionadas.
   - Evitar o comportamento atual de rateio proporcional, porque ele registra pagamento a maior mas não reduz corretamente as próximas parcelas.

3. **Registrar histórico dos abatimentos**
   - Criar registros em `receivable_payments` com o valor realmente abatido em cada parcela.
   - Manter o comprovante quando existir na baixa individual.

4. **Ajustar mensagens da interface**
   - Mostrar no sucesso quantas parcelas foram quitadas e quantas foram reduzidas.
   - Indicar que valor pago a maior foi aplicado nas próximas parcelas.

5. **Validar com teste**
   - Reutilizar a lógica de conciliação já testada e adicionar/cobrir o cenário da baixa manual: parcela de R$ 100 paga com R$ 150 reduz a próxima de R$ 200 para R$ 150.