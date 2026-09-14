# Auditoria completa da JMK Fashion AI para futura loja virtual

## Objetivo
Produzir uma auditoria documental da aplicação existente, sem modificar código, layout, autenticação, dados, tabelas, políticas, arquivos ou integrações. A análise servirá como base para planejar futuramente a JMK MODAS — Loja Virtual.

## Escopo da auditoria

### 1. Inventário técnico e estrutural
- Registrar framework, versões principais, compilador, estilos, biblioteca visual, formulários, validação, ícones, gráficos, estado, relatórios, documentos, animações e testes.
- Mapear a organização do código: entrada da aplicação, páginas, componentes, contextos, hooks, utilitários, integração com o backend e funções externas.
- Identificar dependências redundantes, padrões inconsistentes e pontos de manutenção, sem corrigi-los.

### 2. Rotas, autenticação e usuários
- Documentar todas as rotas existentes, seus componentes, finalidade, nível de proteção e usuários autorizados.
- Explicar login, logout, recuperação de senha, sessão, persistência, proteção de páginas e criação administrativa de usuários.
- Registrar os perfis efetivamente existentes no banco e no código: `admin` e `vendedor`.
- Diferenciar claramente o cadastro interno de funcionários do futuro cadastro de clientes da loja, que ainda não existe.

### 3. Banco de dados e armazenamento
- Inventariar as 27 tabelas confirmadas, com finalidade, campos principais, chave primária, chaves estrangeiras e relacionamentos.
- Listar enums, índices, funções, gatilhos e views; registrar explicitamente quando não houver views.
- Documentar as políticas de acesso existentes e os sete buckets atuais, informando quais são públicos ou privados e seus usos.
- Avaliar a reutilização do armazenamento atual de imagens de produtos na futura vitrine.

### 4. Segurança
- Relatar somente achados confirmados pelo código, esquema real, políticas e scanners.
- Separar riscos críticos, alertas e práticas corretas.
- Cobrir RLS, permissões amplas para usuários autenticados, execução de funções com privilégios elevados, arquivos públicos, autorização das Edge Functions, CORS, sessão no navegador e exposição legítima da chave pública.
- Incluir o resultado da verificação de dependências: nenhuma vulnerabilidade alta ou crítica encontrada.
- Não corrigir, ignorar ou reclassificar nenhum achado nesta etapa.

### 5. Componentes, painel e integrações
- Classificar componentes reutilizáveis em layout, cabeçalho, menu, formulários, tabelas, modais, cards, botões, painel, uploads e notificações.
- Mapear o painel administrativo e indicar o que pode apoiar catálogo, estoque, pedidos, clientes e relatórios da futura loja.
- Descrever as integrações existentes: Lovable Cloud, BubbleWhats/WhatsApp, IA, voz, busca de imagens, CEP, PDFs, armazenamento e automações financeiras.
- Confirmar a ausência atual de integração com Mercado Pago, Melhor Envio e um serviço transacional de e-mail para pedidos.

### 6. Avaliação para e-commerce
- Comparar as estruturas atuais com as necessidades de produtos, categorias, variações, estoque, clientes, carrinho, pedidos, checkout, pagamentos, cupons, promoções, banners e conta do cliente.
- Classificar cada estrutura como: reutilizar, ampliar ou criar.
- Preservar conceitualmente os fluxos internos atuais de PDV, vendas, pré-vendas, financeiro e WhatsApp.
- Propor separação entre a loja pública, a área do cliente e o painel interno.

### 7. Arquitetura futura e integrações planejadas
- Propor páginas públicas: Home, categorias, busca, filtros, produto, carrinho, checkout, login, cadastro, conta e pedidos.
- Propor módulos administrativos: categorias, pedidos online, cupons, promoções, banners e configurações de comércio eletrônico, reutilizando estoque, produtos, clientes e relatórios quando adequado.
- Indicar novas estruturas de dados para pedidos, itens, carrinhos, categorias, cupons, pagamentos, entregas e vínculo entre cliente e autenticação.
- Indicar APIs e Edge Functions futuras para checkout, reserva de estoque, Mercado Pago, webhooks, Melhor Envio e notificações de pedido pelo WhatsApp.
- Apresentar a proposta como arquitetura futura, sem migrations, código ou configuração externa.

## Formato obrigatório do relatório
O relatório final será apresentado exatamente com estas seções, nesta ordem:

1. RESUMO DO PROJETO
2. TECNOLOGIAS
3. ROTAS EXISTENTES
4. AUTENTICAÇÃO
5. USUÁRIOS E PERMISSÕES
6. BANCO DE DADOS
7. RLS E SEGURANÇA
8. STORAGE
9. COMPONENTES REUTILIZÁVEIS
10. PAINEL ADMINISTRATIVO
11. INTEGRAÇÕES EXISTENTES
12. ESTRUTURA ATUAL RELACIONADA A PRODUTOS/VENDAS
13. O QUE PODE SER REUTILIZADO
14. O QUE PRECISA SER CRIADO
15. RISCOS OU PROBLEMAS ENCONTRADOS
16. ARQUITETURA PROPOSTA PARA A LOJA VIRTUAL
17. PLANO DE IMPLEMENTAÇÃO POR ETAPAS
18. RECOMENDAÇÃO FINAL

## Detalhes técnicos verificados que fundamentarão o relatório
- Aplicação SPA com React 18, TypeScript, Vite 5, Tailwind CSS 3, shadcn/ui/Radix e React Router.
- Backend gerenciado pela Lovable Cloud, com autenticação, banco, armazenamento e Edge Functions.
- Rotas públicas atuais limitadas ao login e redefinição de senha; as áreas operacionais exigem sessão e duas páginas exigem administrador.
- Modelo atual contém produtos, variações, estoque, clientes, vendas, itens, pré-vendas, contas financeiras, pagamentos e imagens, mas não contém um fluxo completo de loja pública.
- RLS está habilitado nas 27 tabelas, porém há políticas e permissões que exigem revisão antes de admitir contas de clientes externos.
- O bucket público de imagens de produtos é reutilizável; comprovantes, mídia do WhatsApp, romaneios e etiquetas permanecem privados.
- Não há views no esquema público atualmente.

## Entrega
Um relatório detalhado, baseado somente no estado real observado, distinguindo fatos confirmados, riscos e recomendações futuras. Nenhuma alteração será realizada no projeto durante esta auditoria.
