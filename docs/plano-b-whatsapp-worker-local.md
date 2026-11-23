# Plano B do WhatsApp — worker local no lugar do BubbleWhats

Levantamento feito em 23/11/2026, no 5º dia de parada da instância 9150
(última mensagem recebida: 18/11 19:35:49).

A ideia: se o BubbleWhats não normalizar, subir o número da loja num
programa que roda no PC da JMK (whatsapp-web.js), no mesmo modelo que já
funciona no JASPRINT desde outubro.

Isto é um levantamento, não uma decisão. Nada foi alterado no sistema.

---

## 1. O que depende do BubbleWhats hoje

Toda a conversa com as clientes passa por `https://9150.bubblewhats.com`.
São **6 pontos de envio** e **1 de recebimento**:

| Onde | Arquivo | O que faz |
|---|---|---|
| Recebe tudo | `bubblewhats-webhook` | Mensagem da cliente entra, a Mônica lê e responde |
| Envio manual | `whatsapp-send` | Botão de enviar da tela WhatsApp |
| Envio de mídia | `whatsapp-send-media` | Foto, áudio e documento pela tela |
| Cobrança das 10h | `dunning-cron` | A cobrança automática diária |
| Cobrança manual | `manual-dunning-batch` | Lote disparado por você |
| Cobrança da Ruth | `manual-dunning-ruth` | Caso específico |
| Loja virtual | `infinitepay-create-link` e `infinitepay-webhook` | Link de pagamento e aviso de pedido pago |

Os endpoints usados da API deles, que o worker teria que falar igual:

- `POST /send-message` — `{jid, message}` (texto)
- `POST /send-image` — multipart com o arquivo no campo `image`
- `POST /send-audio` — `{jid, audiourl}`
- `POST /send-voice-note` — `{jid, audiourl}` (a voz da Mônica)
- `POST /send-doc` — `{jid, docurl, filename}`
- `GET /status` e `GET|POST /config` — usados por `bubblewhats-status`
  e `bubblewhats-configure-groups`

## 2. Volume real (para dimensionar o risco)

Mensagens por dia nos 17 dias antes da queda, direto do banco:

| | Recebidas/dia | Enviadas/dia |
|---|---|---|
| Média | ~950 | ~35 |
| Pico | 1.691 (12/11) | 60 (10/11) |

**O envio é baixo — isso é o que importa.** O que leva um número a ser
bloqueado é disparo em massa, e a JMK manda ~35 mensagens por dia, quase
todas em resposta a quem escreveu primeiro. As ~950 recebidas são passivas
(boa parte são grupos de fornecedores) e não contam como risco.

## 3. O que já está pronto no JASPRINT

O worker do JASPRINT (`jasprint-flow/whatsapp-worker/worker.mjs`, 180 linhas)
já resolve a parte difícil e roda em produção há quase dois meses:

- conexão por QR code numa página local (`http://localhost:8099`)
- sessão salva fora do OneDrive, em `AppData\Local` (se for para a nuvem, quebra)
- reconexão automática quando o WhatsApp Web recarrega sozinho
- pausa aleatória de 6 a 15 s entre mensagens, para não parecer robô
- `getNumberId` para resolver o número certo (no Brasil o WhatsApp às vezes
  guarda sem o 9)

**O que falta para a JMK:** o do JASPRINT só *envia*. O da JMK precisa também
*receber* (a Mônica responde) e lidar com foto, áudio e grupo.

## 4. Como ligar isso no sistema — duas formas

### Opção A — o worker finge ser o BubbleWhats (recomendada)

O worker sobe um servidor HTTP local com exatamente os mesmos endereços da
API deles (`/send-message`, `/send-image`, ...), exposto para fora por um
túnel (Cloudflare Tunnel, grátis). No sistema, muda **uma linha em cada um
dos 6 arquivos**: em vez de montar a URL fixa `https://{id}.bubblewhats.com`,
lê de uma variável nova `WHATSAPP_API_BASE`.

Para receber, o worker faz um POST no webhook que já existe, no mesmo
formato de payload que o BubbleWhats manda.

- **A favor:** a Mônica, a IA, a voz, as fotos e a cobrança continuam
  exatamente como estão — nada da lógica muda. Resposta é instantânea.
  Para voltar atrás, basta esvaziar a variável.
- **Contra:** depende de um túnel no PC da loja.

### Opção B — fila no banco, como o JASPRINT

Os 6 pontos gravam numa tabela de fila em vez de chamar a API; o worker
puxa a fila a cada poucos segundos.

- **A favor:** não precisa de túnel nem de porta aberta. Modelo já provado.
- **Contra:** mexe bem mais no sistema (uma função nova de tradução,
  mídia pelo Storage), e a resposta da Mônica passa a ter alguns segundos
  de atraso. O envio deixa de saber na hora se deu certo.

**Recomendo a A.** O diff é pequeno e mecânico, e dá para voltar ao
BubbleWhats numa variável se eles consertarem. A B fica como reserva, caso
o túnel se mostre um problema no PC da loja.

## 5. Riscos — o que precisa estar claro antes

1. **whatsapp-web.js não é oficial.** É automação do WhatsApp Web. Existe
   risco de o número da loja ser bloqueado. O volume de envio baixo deixa
   esse risco pequeno, mas ele não é zero — e o número é o da loja.
2. **O PC precisa ficar ligado.** Se desligar, cai. Não sei se a JMK tem
   uma máquina que fica ligada o dia todo — **essa é a primeira pergunta
   a responder.**
3. **Duas automações no mesmo número brigam.** Antes de ligar o worker,
   é preciso desconectar a instância do BubbleWhats, senão as duas podem
   responder a mesma cliente.
4. **Sai o histórico do painel deles.** O que já está no nosso banco fica;
   o painel do BubbleWhats deixa de ser a fonte.
5. **Grupos.** Funciona, mas o comportamento com grupos grandes precisa de
   teste — hoje boa parte do volume recebido vem de grupo de fornecedor.

## 6. Esforço estimado

| Etapa | Tempo |
|---|---|
| Worker (receber + enviar + mídia + voz) | ~1 dia |
| Túnel e variável nas 6 funções | ~2 horas |
| Teste com número de teste, antes de tocar no da loja | ~2 horas |
| Virada (desconectar BubbleWhats, ler QR, acompanhar) | ~1 hora |

Dá para ter rodando em **um dia e meio de trabalho**, sem contar imprevisto.

## 7. O que eu faria agora

O suporte respondeu hoje às 09:30 ("vamos verificar agora") e o chamado
passou para *Em progresso* — é a primeira movimentação deles em 3 dias.

Minha sugestão: **dar até o fim do dia de hoje** para o BubbleWhats.
Enquanto isso, se você aprovar, eu já deixo o worker escrito e testado com
um número de teste — assim, se amanhã eles não resolverem, a virada é de
uma hora, e se resolverem, o worker fica guardado como seguro contra a
próxima queda.

**Antes de escrever qualquer linha, preciso saber:** tem na loja um
computador que fica ligado o dia todo, com Chrome instalado?
