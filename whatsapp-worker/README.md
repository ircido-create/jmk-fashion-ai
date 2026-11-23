# Worker de WhatsApp da JMK — plano B para o BubbleWhats

Escrito em 23/11/2026, no 5º dia de parada da instância 9150.

Sobe o número da loja num Chrome local (whatsapp-web.js) e **finge ser a API do
BubbleWhats**: expõe os mesmos endereços que o JMKSYSTEM já chama. Com isso, a
virada não mexe na Mônica, na IA, na voz, nas fotos nem na cobrança — só na URL
base que as funções usam.

O levantamento que motivou isto está em
[`docs/plano-b-whatsapp-worker-local.md`](../docs/plano-b-whatsapp-worker-local.md).

**Nada no sistema foi alterado.** Este worker está pronto, mas desligado: as
edge functions continuam apontando para o BubbleWhats.

---

## O que ele faz

| Endpoint | Equivalente no BubbleWhats | Usado por |
|---|---|---|
| `POST /send-message` | idem | `whatsapp-send`, `dunning-cron`, cobranças, Mônica |
| `POST /send-image` | idem (multipart, campo `image`) | `whatsapp-send-media`, fotos da Mônica |
| `POST /send-audio` | idem (`audiourl`) | `whatsapp-send-media` |
| `POST /send-voice-note` | idem (`audiourl`) | voz da Mônica |
| `POST /send-doc` | idem (`docurl`, `filename`) | `whatsapp-send-media` |
| `GET /status` | idem | `bubblewhats-status` |
| `GET` e `POST /config` | idem | `bubblewhats-status`, `bubblewhats-configure-groups` |
| `GET /media/<id>` | a URL que o BubbleWhats põe em `payload.url` | o próprio webhook, ao baixar mídia recebida |

Recebimento: cada mensagem que chega vira um `POST` no webhook configurado, com
o mesmo formato de payload do BubbleWhats (`body`, `caption`, `fromNumber`,
`fromGroup`, `isGroup`, `url`, `mimetype`, `messageContext.key`, …).

## Instalar no PC da loja

Precisa de um computador que fique **ligado o dia todo**, com Chrome e Node 20+.

```
npm install
copy .env.exemplo .env     (e preencher API_TOKEN e BASE_PUBLICA)
npm start
```

Na primeira vez abre `http://localhost:8099` com o QR code: ler no celular da
loja em *WhatsApp > Aparelhos conectados > Conectar aparelho*. A sessão fica
salva em `%LOCALAPPDATA%\jmk-whatsapp` — **fora do OneDrive de propósito**, que
sincronizar essa pasta quebra a sessão.

Para subir junto com o Windows, atalho para `iniciar-oculto.vbs` na pasta
Inicializar (`shell:startup`). O `iniciar.cmd` religa sozinho em 30 s se cair, e
grava log em `%LOCALAPPDATA%\jmk-whatsapp\worker.log`.

## Testar sem tocar no número da loja

```
npm start -- --teste 5511999999999
```

Conecta, manda uma mensagem para esse número e sai. Faça isso com um chip de
teste antes de virar o número da loja.

Com o worker rodando, dá para testar a API por fora:

```
curl -H "Authorization: SEU_API_TOKEN" http://localhost:8098/status
```

## Como virar o sistema para cá (NÃO feito ainda)

1. Subir um túnel para a porta da API — Cloudflare Tunnel é grátis:
   `cloudflared tunnel --url http://localhost:8098`. Anotar a URL e pôr em
   `BASE_PUBLICA` no `.env`, depois reiniciar o worker.
2. **Desconectar a instância do BubbleWhats.** Duas automações no mesmo número
   brigam: as duas responderiam a mesma cliente.
3. Trocar a URL base nas 6 funções de envio. Hoje cada uma monta
   `https://${deviceId}.bubblewhats.com`; passa a ler uma variável nova
   `WHATSAPP_API_BASE`, caindo no BubbleWhats quando ela estiver vazia. Uma
   linha em cada: `whatsapp-send`, `whatsapp-send-media`, `dunning-cron`,
   `manual-dunning-batch`, `manual-dunning-ruth`, `bubblewhats-webhook`
   (`BW_BASE`), mais `bubblewhats-status` e `bubblewhats-configure-groups`.
4. Pôr o token do `.env` no segredo `BUBBLEWHATS_TOKEN` e a URL do túnel em
   `WHATSAPP_API_BASE` (Lovable > Cloud > Secrets).
5. Clicar em **Reconfigurar webhook** no painel (`/whatsapp`). Isso registra no
   worker a URL do webhook **com o `?k=`** — sem o segredo, o webhook recusa
   tudo com 404. Foi o que deixou o WhatsApp mudo em 14/09.
6. Mandar uma mensagem de um celular qualquer para o número da loja e conferir
   se entrou em `whatsapp_messages`.

Para voltar ao BubbleWhats: esvaziar `WHATSAPP_API_BASE`, devolver o token
original e religar a instância.

## O que precisa estar claro

- **whatsapp-web.js não é oficial.** É automação do WhatsApp Web, e existe risco
  de o número da loja ser bloqueado. O volume de envio da JMK é baixo
  (~35/dia, quase tudo em resposta a quem escreveu primeiro), o que deixa o
  risco pequeno — mas não zero, e o número é o da loja.
- **Se o PC desligar, o atendimento para.** Não há reserva.
- **Sai o histórico do painel do BubbleWhats.** O que já está no nosso banco
  fica; o painel deles deixa de ser fonte.
- **Grupos funcionam**, mas o comportamento com grupo grande precisa de teste:
  hoje boa parte do volume recebido vem de grupo de fornecedor.
- A mídia recebida fica no PC por 1 hora, em `%LOCALAPPDATA%\jmk-whatsapp\midia-temp`,
  só o tempo de o webhook baixar. O endereço é um id aleatório de 48 caracteres.
