# Varredura das parcelas sem venda vinculada (órfãs)

São 31 parcelas em 9 grupos. A varredura mostra que a maioria **não é dívida fantasma** — é apenas falta de vínculo. Classificação:

## A) Vínculo perdido, dívida é real — apenas religar à venda (não excluir)

| Cliente | Parcelas | Valor | Venda existente |
|---|---|---|---|
| RAQUEL SOUSA GOMES DA SILVA | 1 | R$ 356,00 | A80BB400 (19/08) |
| TALITA ROSA ARAKAKI ALVES | 6 | R$ 240,00 | 8F5293C9 (13/08) |
| ELIZABETE CORREA DA SILVA FERREIRA | 3 | R$ 710,00 | 7D2348DF (citada na descrição) |
| Leila Assis | 7 | R$ 1.720,00 | 372FB4B9 (citada na descrição) |
| LIS ANGELA ROSA DE ARAUJO ESPERANDIO | 1 | R$ 240,00 (já paga) | 7DA6B402 (citada na descrição) |

## B) Dívida real por transferência — manter como está

| Cliente | Parcelas | Valor | Observação |
|---|---|---|---|
| WILLIANE BARROS MONTEIRO DE SOUZA | 4 | R$ 826,66 | Dívida transferida de CAMILA M. PERESTRELO; sem venda própria por natureza |

## C) Precisa da sua decisão

| Cliente | Parcelas | Valor | Situação |
|---|---|---|---|
| PATRICIA AVELAR | 5 | R$ 583,00 | Venda de 12/08 não existe mais e nada foi pago — dívida fantasma de venda excluída |
| CONSTANCIA FAGUNDES CARDOSO | 2 | R$ 200,00 | Grupo "2/3 e 3/3" de 01/08 sem venda no sistema e sem pagamento — provável resíduo de exclusão |
| ANDREA CARMO DOS SANTOS | 2 | R$ 250,00 | Grupo "3/4 e 4/4" de 04/07; há 3 vendas dela criadas no mesmo minuto (R$ 500 cada) — não dá para dizer qual é a certa sem sua confirmação |

## Plano

1. **Religar os grupos do item A** às vendas correspondentes (preenchendo o vínculo `sale_id`). Nenhum valor muda; passa a aparecer certo na tela da venda e a exclusão futura funciona.
2. **Excluir as 5 parcelas da PATRICIA AVELAR (R$ 583,00)** — dívida fantasma confirmada. Ela fica com R$ 340,00 (venda de hoje).
3. **CONSTANCIA e ANDREA**: aguardo seu OK caso a caso — me diga se a dívida é real (mantenho e religo) ou se veio de venda excluída (removo).
4. **Registro de exclusões (auditoria)**: nova tabela guardando cada exclusão de venda (cliente, valor, itens, parcelas removidas, peças estornadas, quem e quando) e uma tela "Vendas excluídas" na página de Vendas, para conferir a qualquer momento se o valor saiu da conta da cliente.

## Detalhes técnicos

- Religação e limpeza via SQL de dados (update de `accounts_receivable.sale_id`; delete dos 5 ids da Patricia — nenhum tem pagamento ou comprovante).
- Migração: tabela `deleted_sales_log` (`sale_id`, `customer_id`, `customer_name`, `sale_total`, `sale_date`, `items` jsonb, `removed_receivables` jsonb, `restored_stock` jsonb, `deleted_by`, `created_at`), com GRANTs e RLS para autenticados.
- `src/pages/Sales.tsx`: gravar o snapshot em `deleted_sales_log` dentro de `confirmDeleteSale` antes dos deletes; toast final com resumo do estorno; nova aba listando o histórico de exclusões.
