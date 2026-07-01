Limpar a tabela `imported_romaneios` (histórico de romaneios importados) para que os PDFs possam ser reenviados sem serem bloqueados pela verificação de duplicidade.

Não mexe em produtos, variantes, estoque ou contas a pagar já criadas — apenas apaga o histórico usado para deduplicação.

```sql
DELETE FROM imported_romaneios;
```