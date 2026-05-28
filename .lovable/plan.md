## Objetivo
Adicionar `aria-label` em todos os botões de ícone (`size="icon"` ou botões com apenas ícone dentro) que atualmente não possuem nome acessível para leitores de tela.

## Arquivos e ajustes

1. **src/components/layout/AppLayout.tsx**
   - Botão de logout (LogOut): adicionar `aria-label="Sair"`

2. **src/pages/WhatsApp.tsx**
   - Botão copiar webhook (Copy/Check): adicionar `aria-label="Copiar webhook"`

3. **src/pages/Sales.tsx**
   - Botão remover item do carrinho (Trash2): adicionar `aria-label="Remover item"`

4. **src/pages/Receivable.tsx**
   - 3 botões de ação na tabela: marcar como recebido (`aria-label="Marcar como recebido"`), editar (`aria-label="Editar"`), excluir (`aria-label="Excluir"`)

5. **src/pages/Payable.tsx**
   - 3 botões de ação na tabela: marcar como pago (`aria-label="Marcar como pago"`), editar (`aria-label="Editar"`), excluir (`aria-label="Excluir"`)

6. **src/pages/Inventory.tsx**
   - 3 botões: editar produto (`aria-label="Editar"`), excluir produto (`aria-label="Excluir"`), excluir variante (`aria-label="Excluir variante"`)

7. **src/pages/Customers.tsx**
   - 2 botões: editar cliente (`aria-label="Editar"`), excluir cliente (`aria-label="Excluir"`)

8. **src/pages/PreSaleForm.tsx**
   - Botão remover item da pré-venda (`aria-label="Remover item"`)

9. **src/pages/PreSaleDetail.tsx**
   - 2 botões: editar pré-venda (`aria-label="Editar"`), excluir pré-venda (`aria-label="Excluir"`)

10. **src/pages/Conversations.tsx**
    - Botão cancelar gravação (`aria-label="Cancelar gravação"`), botão anexar arquivo (`aria-label="Anexar arquivo"`)

11. **src/components/AIAssistant.tsx**
    - Botão fechar assistente (`aria-label="Fechar assistente"`), botão enviar mensagem (`aria-label="Enviar mensagem"`)

12. **src/hooks/usePagination.tsx**
    - Botão página anterior (`aria-label="Página anterior"`), botão página seguinte (`aria-label="Próxima página"`)

13. **src/pages/POS.tsx**
    - 2 botões de quantidade: diminuir (`aria-label="Diminuir quantidade"`), aumentar (`aria-label="Aumentar quantidade"`)

## Notas
- Botões que já possuem `aria-label` (ex: ThemeToggle, Conversations emoji, FavoriteStickers) e o `SidebarTrigger` (que usa `sr-only` internamente) não serão alterados.
- Botões com `title` também receberão `aria-label` para melhor cobertura de leitores de tela.