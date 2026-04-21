

# Ajustes na Monica (IA SDR)

## 1. Não se reapresentar no meio da conversa

No system prompt da Monica, adicionar regra explícita: **só se apresenta na primeira mensagem da conversa**. Nas mensagens seguintes, vai direto ao ponto, sem "Oi, sou a Monica da JMK…".

Implementação: o webhook já carrega o histórico — vou passar para a IA um marcador `isFirstMessage` (true quando não há mensagens anteriores) e instruir no prompt:
- Se primeira mensagem → cumprimentar e se apresentar uma vez.
- Se já existe histórico → **proibido** se reapresentar, dizer "sou a Monica", "aqui é da JMK", etc. Continuar a conversa naturalmente.

## 2. Formato correto ao falar de tamanhos disponíveis

Adicionar regra no prompt:
- 1 tamanho: `"Ele/ela está disponível no tamanho X"`
- 2+ tamanhos: `"Ele/ela está disponível nos tamanhos X, Y e Z"`
- Concordar gênero (vestido = "ele"; blusa/saia = "ela") com base no nome do produto.

## 3. Reconhecer saudações religiosas comuns

Adicionar ao prompt um glossário de **abreviações/saudações cristãs** (público da JMK é evangélico):

| Cliente envia | Monica responde |
|---|---|
| `ApdDeus`, `A paz`, `A paz de Deus`, `Apaz`, `Paz do Senhor` | `Amém, [nome]! 🙏` (e segue o atendimento) |
| `Deus abençoe`, `Deus te abençoe` | `Amém! Que Deus abençoe você também 💕` |
| `Glória a Deus` | `Amém! 🙌` |

A Monica deve **sempre responder "Amém"** antes de continuar o assunto, nunca dizer que não entendeu a saudação. Se não souber o nome do cliente, responder apenas `Amém! 🙏`.

## 4. Cobrança com data desatualizada (Igor)

Duas correções:

### 4a. Formato da data nas mensagens de cobrança
Hoje a função `dunning-cron` envia a data em formato ISO (`2026-04-10`). Vou trocar para formato brasileiro: `10/04/2026`. Mesma correção será aplicada ao contexto que a Monica recebe (campo `due_date` das dívidas).

### 4b. Por que a Monica mandou a data antiga (22/04)
Verifiquei o banco: a cobrança automática mais recente para o Igor já saiu **com a data correta (10/04)**. O problema relatado veio da **Monica falando na conversa do WhatsApp** — ela tem acesso às últimas 10 mensagens do histórico, e numa interação anterior ela já tinha dito "vence em 22/04". Quando o assunto voltou, ela copiou da memória da conversa em vez de olhar o dado atual.

Correção: adicionar regra **forte** no prompt — *"Sempre que mencionar valores, datas de vencimento ou status de dívidas, use EXCLUSIVAMENTE os dados do bloco DÍVIDAS PENDENTES atual. Nunca repita datas/valores que apareceram no histórico da conversa — esses dados podem estar desatualizados."*

## Arquivos alterados

- **`ai_settings.system_prompt`** (UPDATE no banco): novo prompt com as 4 regras acima.
- **`supabase/functions/whatsapp-webhook/index.ts`**: 
  - Passar marcador `isFirstMessage` (histórico vazio) no contexto da IA.
  - Formatar `due_date` das dívidas como `dd/mm/aaaa` antes de enviar à IA.
- **`supabase/functions/dunning-cron/index.ts`**: formatar `r.due_date` como `dd/mm/aaaa` na mensagem de WhatsApp.

## Resultado

- Monica cumprimenta só uma vez por conversa.
- Tamanhos sempre no formato "no/nos tamanho(s) X, Y e Z".
- "ApdDeus" / "A paz" → `Amém, [nome]! 🙏`.
- Cobranças (manuais e automáticas) sempre com data **atualizada** e em formato **dd/mm/aaaa**.

