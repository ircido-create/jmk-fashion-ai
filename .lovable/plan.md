# Corrigir erro "invalid input" no cadastro da cliente Silviane Tomaz

## O que está acontecendo

O cadastro da Silviane Tomaz tem um campo de **Endereço com 592 caracteres** — na verdade é um trecho de conversa que foi salvo por engano no lugar do endereço (transcrição de áudio da cliente).

O formulário de clientes só aceita endereço até 300 caracteres. Quando você abre e salva esse cadastro, a validação falha e, pela forma como a regra está escrita, a mensagem exibida vira apenas "invalid input", sem dizer qual campo está errado.

## O que será feito

1. **Mensagens de erro claras**: ajustar a validação do formulário de clientes para que qualquer campo inválido mostre o motivo real (ex.: "Endereço deve ter no máximo 600 caracteres") em vez de "invalid input".
2. **Aumentar o limite do campo Endereço** de 300 para 600 caracteres (e Observações de 500 para 1000), evitando bloqueio em cadastros existentes.
3. **Limpar o cadastro da Silviane**: mover o texto da conversa que está no campo Endereço para o campo Observações, deixando o endereço vazio para você preencher corretamente.

## Detalhes técnicos

- `src/pages/Customers.tsx`: o schema zod usa `z.string().trim().max(N).optional().or(z.literal(""))`. Quando o texto excede o limite, ambos os ramos da união falham e o erro reportado é o do `z.literal("")` (`invalid_literal` → "Invalid input"). Reescrever os campos opcionais com `.max(N, { message: ... })` e normalização (`.transform`) em vez do `.or(z.literal(""))`, e mostrar o caminho do campo no toast.
- Migração de dados: `UPDATE customers SET notes = address, address = NULL` apenas para o registro `de7761e0-...`.
