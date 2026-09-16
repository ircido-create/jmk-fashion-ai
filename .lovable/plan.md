# Corrigir falha 502 na configuração do BubbleWhats

## Objetivo
Impedir que a indisponibilidade temporária do BubbleWhats derrube a ação no painel, mantendo a mensagem clara para o usuário.

## Alterações
- Preservar as tentativas com tempo limite já existentes.
- Tratar respostas 502/503/504 como indisponibilidade temporária esperada, devolvendo uma resposta válida ao painel com indicação de falha recuperável.
- Ajustar o painel para mostrar a mensagem amigável do servidor, sem expor a página HTML do provedor.
- Implantar somente a função `bubblewhats-configure-groups` e validar seu comportamento.

## Limite
A correção evita o erro de execução e orienta nova tentativa; ela não consegue restabelecer um servidor externo do BubbleWhats enquanto estiver fora do ar.
