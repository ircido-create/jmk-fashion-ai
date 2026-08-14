# Verificar token do WhatsApp (BubbleWhats)

## O que já foi verificado agora

- O servidor do aparelho **9023** está no ar: uma chamada sem credencial retorna `401 Unauthorized` (resposta esperada de servidor saudável). O erro `502 Bad Gateway` visto nos registros anteriores era instabilidade temporária do provedor, não do sistema.
- Na tela que você enviou, o aparelho aparece **Conectado**, com o endpoint de recebimento apontando corretamente para o webhook do sistema e "Receber mensagens de grupos" ligado.
- As credenciais `BUBBLEWHATS_DEVICE_ID` e `BUBBLEWHATS_TOKEN` já estão salvas no cofre do backend. O valor salvo não pode ser lido de volta — só dá para saber se está certo testando uma chamada autenticada.

## Plano

1. **Teste real de credencial**: rodar a verificação de conexão (função `bubblewhats-status`) e ler o código de resposta:
   - `200` → token válido, nada a fazer;
   - `401/403` → token salvo está errado ou expirou;
   - `5xx` → instabilidade do provedor, repetir depois.
2. **Mostrar o resultado na tela**: no painel "Diagnóstico da conexão" da página WhatsApp + IA, exibir explicitamente uma linha **"Token: válido / inválido / provedor indisponível"**, hoje o painel não separa esse caso do erro genérico.
3. **Se o token estiver inválido**: salvar novamente o token exibido no painel do BubbleWhats (o do print) no cofre de secrets e repetir o teste.
4. **Reconfigurar webhook** apenas se o teste mostrar endpoint divergente — pelo print ele está correto, então provavelmente não será necessário.

## Detalhes técnicos

- `supabase/functions/bubblewhats-status/index.ts`: distinguir `statusHttp === 401 || 403` como `tokenValid: false` e devolver esse campo no JSON (hoje só devolve `connected`/`rawState`).
- `src/pages/WhatsApp.tsx`: renderizar a nova linha de token no card de diagnóstico, com badge verde/vermelho/cinza.
- Nenhuma alteração no fluxo da Mônica, nos prompts ou nos dados.
