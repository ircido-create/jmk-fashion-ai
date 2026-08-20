# Plano de Implementação: Arredondamento e Pagamento Quinzenal no PDV

Adicionar flexibilidade no fechamento de vendas na "Carteira" (fiado), permitindo o arredondamento manual das parcelas (mantendo o total) e a opção de periodicidade quinzenal.

## Alterações Propostas

### Frontend (src/pages/POS.tsx)

1.  **Novos Estados:**
    *   `paymentFrequency`: "mensal" ou "quinzenal".
    *   `manualInstallmentValues`: Array de strings/números para armazenar edições manuais nas parcelas.
    *   `isAdjustingInstallments`: Boolean para controlar a visibilidade do modo de edição.

2.  **Lógica de Cálculo de Parcelas:**
    *   Atualizar a função `addMonths` ou criar uma nova `addPeriod` que suporte semanas/quinzenas (14-15 dias).
    *   Refatorar a lógica que gera os `records` de contas a receber para usar os valores manuais quando disponíveis.
    *   Implementar validação de soma: ao editar manualmente uma parcela, o sistema deve garantir que o total final permaneça inalterado (possivelmente ajustando a última parcela automaticamente ou exigindo que o usuário equilibre).

3.  **Interface do Usuário (UI):**
    *   No Step 3 (Pagamento), quando "Carteira" estiver selecionada:
        *   Adicionar um seletor de frequência: "Mensal" (padrão) vs "Quinzenal".
        *   Adicionar um botão "Ajustar Valores das Parcelas".
        *   Ao clicar, exibir uma lista das parcelas geradas com campos de input para o valor de cada uma.
        *   Exibir um indicador de "Diferença" para que o usuário veja se a soma das parcelas bate com o total da venda.

4.  **Integração com Salvar (Finalizar):**
    *   A função `finalize` deve ler `manualInstallmentValues` e a `paymentFrequency` para criar os registros no banco de dados.

## Detalhes Técnicos
*   **Frequência Quinzenal:** Será implementada somando 15 dias à data anterior (ou 14, conforme preferência de negócio, mas 15 é o padrão para "quinzenal").
*   **Arredondamento:** O foco é permitir que o usuário transforme R$ 33,33 + R$ 33,33 + R$ 33,34 em algo como R$ 30,00 + R$ 30,00 + R$ 40,00 se desejar, sem alterar o total da venda.
*   **Validação:** Impedir a finalização se a soma das parcelas manuais não for exatamente igual ao total líquido da venda (após descontos).
