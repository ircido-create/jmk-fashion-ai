## Problema
A Mônica (IA do WhatsApp) está respondendo "Desculpe, estou com uma instabilidade no momento. Pode tentar novamente em instantes?" para clientes. Isso ocorre na edge function `whatsapp-webhook` quando a chamada à `ai.gateway.lovable.dev` falha — o código trata todos os erros da mesma forma genérica.

## Causa provável
Erro 402 (créditos esgotados) ou 429 (rate limit) na Lovable AI Gateway, como já observado na edge function `scan-label` anteriormente.

## Plano de correção

### 1. Melhorar tratamento de erro no `callAI` (`whatsapp-webhook/index.ts`)
Diferenciar os status codes da resposta da IA:
- **402** → retornar mensagem amigável ao cliente informando que a loja será notificada, e registrar erro visível no painel (tabela de logs/config)
- **429** → adicionar retry com exponential backoff (até 3 tentativas) antes de desistir
- **5xx / outros** → manter mensagem de instabilidade, mas logar o status exato

### 2. Adicionar fallback de modelo
Se o modelo `google/gemini-2.5-flash` falhar com 402, tentar modelo mais barato (`google/gemini-2.5-flash-lite`) como fallback antes de desistir.

### 3. Registrar falha da IA de forma visível
Adicionar um log na tabela `ai_settings` ou criar um registro temporário para que o administrador veja no painel que há problema com os créditos da IA.

### 4. Testar
Executar uma chamada de teste à edge function para confirmar qual erro está ocorrendo e validar a correção.

## Resultado esperado
- Clientes no WhatsApp recebem mensagens úteis mesmo quando há falha na IA
- O administrador consegue identificar rapidamente se o problema é créditos (402) ou outro erro
- Redução de "instabilidade" para clientes reais via retry em 429