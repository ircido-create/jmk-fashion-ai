

## Problema: Áudio do Igor sumiu e Monica não respondeu

### Causa raiz
Confirmei nos logs: o **token de acesso do WhatsApp expirou** às 14:00 PDT (sessão temporária da Meta). O áudio do Igor chegou depois disso, então:

1. O webhook tentou baixar o áudio da Meta → **401 Authentication Error** (token expirado)
2. Como o download falhou, a função saiu silenciosamente sem registrar a mensagem nem avisar a cliente
3. Mesmo se tivesse transcrito, o envio da resposta também falharia (mesmo 401)

Erro exato dos logs:
```
Meta send error: 401 "Session has expired on Tuesday, 21-Apr-26 14:00:00 PDT"
media meta error: 401 "Authentication Error"
```

### O que precisa ser feito

**1. Renovar o token do WhatsApp (ação sua, no painel)**
O token atual é um token de usuário temporário (expira em ~24h). Para produção, você precisa gerar um **System User Token permanente** no Meta Business:
- Meta Business Suite → Configurações → Usuários do sistema
- Criar/selecionar um System User → Gerar Token → escolher o app do WhatsApp → permissões `whatsapp_business_messaging` + `whatsapp_business_management` → marcar **"Nunca expira"**
- Colar o novo token em **Configurações → WhatsApp** no app

**2. Tornar o webhook mais resiliente (eu implemento)**

Mudanças no `supabase/functions/whatsapp-webhook/index.ts`:

- **Registrar áudio mesmo quando falhar:** salvar uma mensagem inbound `[Áudio recebido — falha ao baixar/transcrever]` na conversa, para você ver que o cliente mandou áudio.
- **Detectar token expirado (401 erro 190):** quando o `downloadWhatsAppMedia` ou `sendWhatsApp` retornar 401, marcar a config como problemática e logar de forma destacada.
- **Avisar a cliente:** se o áudio falhou no download (não só na transcrição), também enviar a mensagem "não consegui ouvir seu áudio, pode escrever?" — hoje só avisa quando a transcrição volta vazia.
- **Banner de aviso na UI:** adicionar um indicador na página **Configurações → WhatsApp** mostrando "⚠️ Token possivelmente expirado — última falha: HH:MM" baseado em uma nova coluna `last_error_at` em `whatsapp_config`.

**3. Migração no banco**
Adicionar à tabela `whatsapp_config`:
- `last_error_at timestamptz` — última vez que a Meta retornou 401
- `last_error_message text` — texto do erro

A função grava aí quando detectar 401; a UI lê e mostra alerta visual.

### Resultado esperado
- Você vai ver claramente no app quando o token expirar (banner vermelho em Configurações)
- Áudios não somem mais — sempre aparecem na conversa, mesmo com erro
- A cliente recebe um aviso quando o áudio falha (em vez de silêncio)
- Depois que você colar o token permanente, isso não acontece mais

### Detalhes técnicos
- Arquivos editados: `supabase/functions/whatsapp-webhook/index.ts`, `src/pages/Settings.tsx`
- Nova migração SQL: 2 colunas em `whatsapp_config`
- Helper `metaFetch()` que centraliza chamadas à Graph API e grava `last_error_at` em caso de 401
- Sem mudanças nas tabelas de mensagens/conversas
- A correção do código não substitui a renovação do token — ela apenas evita que mensagens sumam silenciosamente

