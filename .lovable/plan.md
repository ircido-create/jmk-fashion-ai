## Problema

Ao abrir a página **Estoque**, o app dispara automaticamente a rotina `reprocessRomaneioPhotos`, que baixa todos os PDFs de romaneios importados, renderiza cada página e chama a IA para tentar associar fotos aos produtos sem imagem. Como isso roda toda vez que a página é montada (ex.: navegar para outra tela e voltar), o usuário percebe como um "loop buscando fotos" — a mensagem "Buscando fotos..." reaparece constantemente e a interface fica pesada.

O código responsável está em `src/pages/Inventory.tsx`, no `useEffect` das linhas 229–254 (bloco marcado como "Auto: busca fotos automaticamente...").

## Solução

Remover o disparo automático e manter apenas o botão manual **"Buscar fotos"** que já existe no cabeçalho da página. Assim:

- A página abre instantaneamente, sem consumo de rede/IA.
- O usuário decide quando reprocessar romaneios clicando no botão.
- Nada mais muda na UI: botão, progresso e mensagens continuam iguais.

## Alterações técnicas

- `src/pages/Inventory.tsx`
  - Remover o `useEffect` de auto-execução (linhas 229–254) e o `autoRanRef` associado.
  - Remover o import de `useRef` se não for mais usado em outro ponto do arquivo.
  - Manter intactos: `handleReprocessPhotos`, botão "Buscar fotos", estados `reprocessing`/`reprocessMsg`.

Nenhuma mudança em backend, edge functions ou tabelas.
