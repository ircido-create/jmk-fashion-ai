

# JMK ADM — Sistema de Gestão para Loja de Roupas Femininas

Sistema completo com login, gestão financeira, estoque, atendimento por IA via WhatsApp Oficial Meta, e design Liquid Glass (iOS).

## Visão geral das telas

```text
┌─ Login / Cadastro
└─ Painel (após login)
   ├─ Dashboard (KPIs + gráficos)
   ├─ Contas a Pagar
   ├─ Contas a Receber  ──► dispara cobrança automática
   ├─ Estoque (produtos, tamanhos P/M/G, cores, qtd, preço)
   ├─ Clientes
   ├─ WhatsApp IA
   │   ├─ Configuração (tokens Meta + webhook URL)
   │   ├─ Conversas (histórico em tempo real)
   │   └─ Personalidade da IA (prompt editável)
   ├─ Usuários (CRUD — só Admin)
   └─ Configurações
   
[Botão flutuante] Assistente Virtual (chat IA dentro do app)
```

## Funcionalidades por módulo

**Autenticação**
- Login por e-mail/senha (Lovable Cloud).
- Dois perfis: **Admin** (tudo) e **Vendedor** (sem Usuários e sem Configurações sensíveis).
- Proteção de rotas por perfil.

**Contas a Pagar**
- CRUD: descrição, fornecedor, valor, vencimento, status (pendente/pago/vencido), categoria.
- Marcar como pago, filtros por período e status, total do mês.

**Contas a Receber**
- CRUD vinculado a Cliente: valor, vencimento, parcela, status.
- Atualização automática para "vencido" quando passa do prazo.
- Alimenta a rotina diária de cobrança via WhatsApp.

**Estoque**
- Cadastro de produto: nome, descrição, categoria (vestido, blusa, calça…), preço, custo.
- **Variações por tamanho e cor** com quantidade individual (ex: Vestido Floral — P Rosa: 5un, M Rosa: 3un).
- Alerta de estoque baixo, busca e filtros.
- A IA consulta esse banco para responder no WhatsApp.

**Clientes**
- CRUD: nome, telefone (E.164, ex: +5511999999999), e-mail, observações.
- Histórico de compras e dívidas.

**WhatsApp + IA (Meta Cloud API Oficial)**
- Tela de configuração para colar: Access Token, Phone Number ID, WABA ID, App Secret, Verify Token.
- Webhook público que recebe mensagens da Meta, chama a IA Lovable (Gemini) com contexto do estoque + cliente + dívidas, e responde automaticamente.
- **Comportamento da IA**:
  - Tom amigável e acolhedor.
  - Sempre que receber "Paz de Deus", "A paz de Deus" ou variações, responde **"Amém"**.
  - Informa preços, tamanhos e cores disponíveis consultando o estoque.
  - Informa valores em aberto e datas de vencimento ao cliente.
  - Encaminha conversa para humano se solicitado.
- Histórico de conversas visível no painel.

**Cobrança automática diária**
- Cron job diário (Lovable Cloud) que:
  1. Busca contas vencidas não pagas.
  2. Para cada uma, a IA gera mensagem cordial personalizada.
  3. Envia via WhatsApp Oficial.
  4. Registra log de envio.

**Assistente Virtual (dentro do app)**
- Botão flutuante com bolha de chat estilo iOS.
- Responde dúvidas sobre como usar o sistema (criar conta, cadastrar produto, etc.) usando IA Lovable.

**CRUD de Usuários (Admin)**
- Listar, criar, editar perfil (Admin/Vendedor), desativar, redefinir senha.
- Tabela `user_roles` separada (segurança contra escalonamento de privilégio).

## Design — Liquid Glass iOS estilo Bling

- **Paleta**: fundo gradiente suave (lavanda → rosa pálido → branco), superfícies com `backdrop-blur` forte, bordas translúcidas (`white/20`), sombras suaves coloridas.
- **Cards "vidro"**: `bg-white/40 backdrop-blur-xl border border-white/30 rounded-2xl shadow-[0_8px_32px_rgba(31,38,135,0.1)]`.
- **Acento**: roxo/rosa vibrante (#A855F7 → #EC4899) em botões e KPIs.
- **Tipografia**: SF Pro / Inter, títulos grandes e leves.
- **Animações**: fade-in em listas, scale ao hover, transições suaves de rota, micro-animação no botão do assistente (pulse), skeleton ao carregar.
- **Sidebar** colapsável estilo Bling com ícones grandes e estado ativo destacado em vidro colorido.
- Totalmente responsivo (mobile = bottom nav).

## Detalhes técnicos

**Stack**: React + Vite + TypeScript + Tailwind + shadcn/ui + Lovable Cloud (Supabase) + Lovable AI Gateway (Gemini).

**Banco de dados** (com RLS):
- `profiles` (id, full_name, email, active)
- `user_roles` (user_id, role: 'admin'|'vendedor') — função `has_role()` SECURITY DEFINER
- `customers` (id, name, phone, email, notes)
- `products` (id, name, description, category, price, cost, low_stock_threshold)
- `product_variants` (id, product_id, size, color, quantity)
- `accounts_payable` (id, supplier, description, amount, due_date, status, category, paid_at)
- `accounts_receivable` (id, customer_id, description, amount, due_date, status, paid_at)
- `whatsapp_config` (id, access_token, phone_number_id, waba_id, verify_token, app_secret) — só Admin
- `whatsapp_conversations` (id, customer_phone, customer_id)
- `whatsapp_messages` (id, conversation_id, direction, content, created_at)
- `ai_settings` (id, system_prompt, persona)
- `dunning_logs` (id, receivable_id, sent_at, message)

**Edge functions**:
- `whatsapp-webhook` (verify GET + receive POST, valida assinatura X-Hub-Signature-256, chama IA, responde) — `verify_jwt = false`.
- `whatsapp-send` (envia mensagem via Graph API).
- `ai-chat-customer` (IA com contexto: estoque + dívidas do cliente + regra "Amém").
- `ai-assistant` (assistente virtual interno).
- `daily-dunning` (cron diário 09:00 BRT — varre vencidos e dispara cobrança).

**Secrets necessários** (você fornece após contratar Meta WhatsApp Business):
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_WABA_ID`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_VERIFY_TOKEN` (você inventa uma string aleatória)

**Segurança**:
- RLS em todas as tabelas; tokens do WhatsApp só leitura para Admin.
- Validação Zod em todos os formulários e edge functions.
- Validação de assinatura HMAC do webhook Meta.
- Roles em tabela separada com função SECURITY DEFINER.

## Plano de implementação (fases)

Como o sistema é grande, vou construir em fases para garantir qualidade. Esta primeira entrega cobrirá:

**Fase 1 (esta entrega)**:
1. Lovable Cloud + autenticação + tabelas + roles
2. Layout Liquid Glass + sidebar + dashboard
3. CRUD: Clientes, Produtos com variações, Contas a Pagar, Contas a Receber, Usuários
4. Assistente virtual interno (IA Lovable)

**Fase 2 (depois que Fase 1 estiver validada)**:
5. Tela de configuração WhatsApp Meta + webhook + envio
6. IA de atendimento ao cliente (com regra "Amém" e contexto de estoque/dívidas)
7. Cobrança automática diária (cron)

Você poderá testar o WhatsApp assim que tiver os tokens da Meta em mãos.

