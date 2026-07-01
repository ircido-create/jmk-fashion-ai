## Diagnóstico

Você enviou 28 PDFs mas só 2 foram gravados em `imported_romaneios` (23:49:58 e 23:50:14). Cada romaneio leva ~8-15s (upload + IA Gemini). Para 28 arquivos em sequência isso passa de 5 minutos, e hoje o fluxo tem 3 fragilidades:

1. Roda 1 por vez → lentíssimo.
2. Sem retry: qualquer 429/5xx do gateway derruba aquele arquivo.
3. Sem feedback ao vivo — a modal só mostra "Processando..." e o toast final só aparece no fim. Se você fecha a modal, muda de aba ou o navegador pausa a tab, o loop morre silenciosamente e o resultado se perde.

## O que vou mudar em `src/pages/Inventory.tsx`

- **Progresso ao vivo na modal**: barra "processando X de 28 — arquivo.pdf" + lista rolável marcando cada arquivo em tempo real (✅ / ⏭️ / ❌).
- **Concorrência 3 em paralelo** (pool simples). Reduz ~5min para ~1-2min em 28 PDFs, sem estourar rate limit da IA.
- **Retry com backoff** (2 tentativas extras, 2s/5s) para erros 429 e 5xx vindos do `parse-romaneio`. Erros 4xx "reais" (duplicado, sem itens) continuam sem retry.
- **Aviso ao sair** (`beforeunload`) enquanto a importação está rodando, para você não fechar a aba sem querer.
- **Botão "fechar" desabilitado** durante o processo (já é hoje) + botão "cancelar" que apenas para de enfileirar novos, deixando os em voo terminarem.
- **Relatório final em modal** (não só toast): mostra todos os 28 com status individual e permite copiar o texto — assim se algum falhar você vê exatamente qual e por quê.

## Fora de escopo

- Não muda a Edge Function `parse-romaneio` nem o schema.
- Não altera a busca de fotos em background (continua rodando depois).

Depois de aplicar, teste reenviando o mesmo lote — os 2 já importados aparecerão como "⏭️ já importado" e os 26 restantes serão processados agora com progresso visível.