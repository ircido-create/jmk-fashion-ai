
## Contexto

Quando um cliente responde ao status do WhatsApp, a Meta **não envia** ao webhook a foto/miniatura do status — só o texto. Logo, a Monica precisa de uma fonte de verdade alternativa para saber quais peças estão "no ar" naquele momento e qual delas o cliente provavelmente está comentando.

A solução combina dois pilares:

1. **Registro rápido do "Status do Dia"** — você marca quais peças do inventário estão postadas no status (válido por 24h, igual ao status real).
2. **IA de visão + heurística** — quando chega uma resposta vaga ("quero este", "amei", "valor?"), a Monica considera APENAS as peças ativas no status e usa IA para escolher a mais provável com base no contexto da conversa. Se houver ambiguidade, ela pergunta de forma natural com mini-foto.

## Fluxo do usuário

### Postando um status
1. Você abre uma nova aba **"Status do Dia"** no menu (ou um botão flutuante no Inventário).
2. Vê todas as peças com foto. Clica nas que acabou de postar no status → ficam marcadas como "ativas" por 24h.
3. (Atalho) Botão "Postar do romaneio de hoje" pré-seleciona as peças cadastradas nas últimas X horas.

### Cliente responde
1. Cliente responde "quero este" → webhook recebe só o texto.
2. Monica detecta resposta curta/ambígua + verifica se há peças no "Status do Dia" ativo.
3. **Caso 1 — só 1 peça ativa**: assume essa peça, segue a venda normalmente ("Oi linda! O vestido rosa? Tenho nos tamanhos P, M, G — qual o seu?").
4. **Caso 2 — várias peças ativas**: usa IA + histórico (ex: cliente já tinha perguntado sobre rosa antes? hora do dia bate com algum post?) para escolher top-1. Se confiança alta, segue. Se baixa, responde com até 3 mini-fotos: "Oi! Foi qual dessas? 😊".
5. Toda venda fechada via status fica marcada com origem `status` no relatório (bônus pra você ver o ROI do canal).

## Componentes técnicos

### 1. Banco de dados
Nova tabela `status_posts`:
- `id`, `product_id` (fk products), `variant_id` (fk product_variants opcional)
- `image_url` (foto que foi pro status — pode ser a do produto ou upload novo)
- `posted_at`, `expires_at` (default `posted_at + 24h`)
- `caption` (opcional, texto que você escreveu no status)
- `created_by`

RLS: staff vê/insere/atualiza, admin deleta. Índice em `expires_at` para busca rápida de "ativos".

### 2. UI: Página "Status do Dia" (`/status`)
- Grid de cards com peças do inventário (busca + filtro por categoria/fornecedor).
- Toggle "ativo no status" em cada card. Contador "X peças ativas · expiram em Yh".
- Botão "Limpar status" (encerra todos antes de 24h).
- Item no `AppSidebar` com ícone de stories.

### 3. Webhook — detecção de resposta de status
No `whatsapp-webhook/index.ts`, dentro de `buildContext()`:
- Buscar `status_posts` onde `expires_at > now()`.
- Adicionar ao `contextText` enviado à IA uma seção:
  ```
  PEÇAS ATIVAS NO STATUS AGORA (cliente PODE estar respondendo a uma destas):
  - [Nome] (id: X) — R$ Y — tamanhos disponíveis: ...
  - ...
  ```
- Atualizar o `SALES_FOCUS` prompt: "Se a mensagem do cliente é curta/ambígua ('quero', 'amei', 'valor', 'tem?') E há peças no status ativo, assuma que ele está respondendo ao status. Se houver só 1 peça ativa, confirme essa peça. Se houver várias, escolha a mais coerente com o histórico OU peça confirmação enviando até 3 fotos."

### 4. Heurística de envio de fotos
A função `searchVariantsWithImages()` já existe para "manda foto". Adicionar nova função `getActiveStatusVariants()` que retorna as peças do `status_posts` ativo, e quando a IA decidir "preciso confirmar qual peça", o webhook envia 1-3 fotos das ativas com legendas curtas ("1️⃣ Vestido rosa", "2️⃣ Conjunto verde").

### 5. (Opcional, fase 2) Match por imagem
Se o cliente encaminhar a imagem do status como mídia, a Monica já recebe `image` no webhook. Podemos rodar Lovable AI (gemini-3-flash) com a imagem + as fotos das peças ativas e pedir match. Isso cobre 100% dos casos.

### 6. Relatório
Marcar nas vendas (`sales.notes` ou nova coluna `source`) quando a venda foi originada de status, para você ver depois "X% do faturamento vem do status".

## O que será entregue na fase 1

1. Tabela `status_posts` + migration com RLS.
2. Página `/status` com grid de produtos e toggle ativo/inativo + 24h auto-expira.
3. Item no sidebar.
4. Webhook atualizado: contexto de peças ativas injetado no prompt da Monica + lógica de envio de fotos para desambiguar.
5. Prompt da Monica ajustado para tratar respostas curtas como "resposta de status" quando houver peças ativas.

A fase 2 (match por imagem encaminhada) fica pra depois, se você quiser.

## Limitações honestas

- **Não há como** a Monica ler a miniatura do status diretamente da resposta do cliente — é restrição da Meta, não tem volta.
- A precisão depende de você marcar as peças ativas. Se esquecer, a Monica volta ao comportamento atual (perguntar o que é).
- Se duas peças ativas forem muito parecidas, a confirmação com mini-fotos é o caminho mais seguro.
