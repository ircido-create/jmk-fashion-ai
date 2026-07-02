## Alterar senha do admin

Por segurança, senhas do sistema de autenticação não podem ser gravadas diretamente via SQL (ficam com hash gerenciado pelo backend). Existem duas formas de fazer isso:

### Opção A — Você mesmo faz agora (recomendado, mais rápido)
1. Abra o painel do backend (botão "View Backend").
2. Vá em **Users**.
3. Localize `ircido@gmail.com`.
4. Clique nos três pontinhos → **Send password recovery** ou **Reset password** e defina `J@s3m6240`.

Não precisa alterar nada no código.

### Opção B — Eu implemento um botão temporário "Redefinir senha" para admins
Se preferir, crio uma Edge Function `admin-set-password` (usando a chave de serviço no servidor) e um pequeno formulário na tela `/usuarios`, restrito a quem tem role `admin`, para redefinir a senha de qualquer usuário. Fica disponível para uso futuro também.

Detalhes técnicos da Opção B:
- Edge Function protegida: valida que o chamador é `admin` via `has_role()` antes de invocar `auth.admin.updateUserById(id, { password })`.
- UI: campo "Nova senha" + botão em cada linha da tabela de usuários.
- Nenhuma senha trafega em logs.

Qual opção prefere? Se escolher a B, já sigo com a implementação.
