-- Excluir venda passa a ser uma operacao so, feita pelo banco, e deixa registro.
--
-- Antes: a tela apagava a venda em quatro passos soltos (estorna cada peca,
-- apaga as parcelas, apaga os itens, apaga a venda). Se um passo falhasse no
-- meio, o estoque ficava errado e ninguem sabia. E depois de excluida a venda
-- nao deixava rastro nenhum: nem o numero dela existia mais em lugar algum.
--
-- Agora: uma funcao faz tudo de uma vez (ou tudo acontece, ou nada acontece) e
-- guarda o retrato da venda em sale_deletions, inclusive as pecas que NAO
-- voltaram ao estoque por nao terem variacao amarrada a grade.

-- 1) O registro do que foi excluido ------------------------------------------

create table if not exists public.sale_deletions (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid        not null,
  sale_short          text        not null,
  customer_id         uuid,
  customer_name       text,
  sale_date           timestamptz,
  total               numeric,
  payment_method      text,
  installments        integer,
  notes               text,
  items               jsonb       not null default '[]'::jsonb,
  restored_units      integer     not null default 0,
  skipped_units       integer     not null default 0,
  receivables_removed integer     not null default 0,
  receivables_amount  numeric     not null default 0,
  deleted_by          uuid,
  deleted_at          timestamptz not null default now()
);

comment on table public.sale_deletions is
  'Retrato de cada venda excluida: cliente, pecas, valor e quanto voltou ao estoque. So a funcao excluir_venda escreve aqui.';
comment on column public.sale_deletions.sale_short is
  'Os 8 primeiros caracteres do id da venda em maiusculas — o "numero" que aparece na tela e no recibo.';
comment on column public.sale_deletions.skipped_units is
  'Pecas que NAO voltaram ao estoque porque o item nao tinha variacao amarrada a grade.';

create index if not exists idx_sale_deletions_deleted_at on public.sale_deletions (deleted_at desc);
create index if not exists idx_sale_deletions_customer   on public.sale_deletions (customer_id);
create index if not exists idx_sale_deletions_sale       on public.sale_deletions (sale_id);

alter table public.sale_deletions enable row level security;

-- Quem opera o sistema le o registro. Ninguem escreve direto: a unica porta de
-- entrada e a funcao abaixo, que roda como dona da tabela.
drop policy if exists "Staff view sale_deletions" on public.sale_deletions;
create policy "Staff view sale_deletions"
  on public.sale_deletions
  for select
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'vendedor'::public.app_role)
  );

-- 2) A exclusao em si --------------------------------------------------------

create or replace function public.excluir_venda(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale          public.sales%rowtype;
  v_short         text;
  v_customer_name text;
  v_items         jsonb;
  v_rec_ids       uuid[];
  v_pagas         integer := 0;
  v_rec_removed   integer := 0;
  v_rec_amount    numeric := 0;
  v_restored      integer := 0;
  v_skipped       integer := 0;
  v_it            record;
  v_updated       integer;
begin
  -- Apagar venda e coisa de dono, igual a regra de DELETE das tabelas.
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Sem permissão para excluir vendas';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null then
    raise exception 'Venda não encontrada — recarregue a tela';
  end if;

  v_short := upper(left(v_sale.id::text, 8));

  select c.name into v_customer_name
    from public.customers c
   where c.id = v_sale.customer_id;

  -- As parcelas desta venda, pelos tres caminhos que a tela usa: a coluna
  -- sale_id, a parcela apontada pela propria venda e a descricao "venda XXXXXXXX".
  select coalesce(array_agg(distinct r.id), '{}'::uuid[])
    into v_rec_ids
    from public.accounts_receivable r
   where r.sale_id = p_sale_id
      or (v_sale.receivable_id is not null and r.id = v_sale.receivable_id)
      or coalesce(r.description, '') ilike '%venda ' || v_short || '%';

  -- Venda com pagamento registrado nao se apaga: estorna-se o pagamento antes.
  select count(*)
    into v_pagas
    from public.accounts_receivable r
   where r.id = any(v_rec_ids)
     and (
       r.status::text = 'pago'
       or exists (select 1 from public.receivable_payments p where p.receivable_id = r.id)
     );

  if v_pagas > 0 then
    raise exception 'Não é possível excluir: % parcela(s) desta venda já têm pagamento registrado. Estorne o pagamento antes.', v_pagas;
  end if;

  -- O retrato dos itens, tirado do banco, antes de apagar qualquer coisa.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'product_id',    i.product_id,
               'variant_id',    i.variant_id,
               'product_name',  i.product_name,
               'variant_label', i.variant_label,
               'quantity',      i.quantity,
               'unit_price',    i.unit_price,
               'unit_cost',     i.unit_cost
             )
             order by i.product_name
           ),
           '[]'::jsonb
         )
    into v_items
    from public.sale_items i
   where i.sale_id = p_sale_id;

  -- Estorno peca por peca. Item sem variacao (ou com variacao que ja nao
  -- existe) nao tem onde voltar: fica contado em skipped_units.
  for v_it in
    select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    v_updated := 0;
    if v_it.variant_id is not null then
      update public.product_variants
         set quantity   = greatest(0, quantity + v_it.quantity),
             updated_at = now()
       where id = v_it.variant_id;
      get diagnostics v_updated = row_count;
    end if;

    if v_updated > 0 then
      v_restored := v_restored + v_it.quantity;
    else
      v_skipped := v_skipped + v_it.quantity;
    end if;
  end loop;

  select count(*), coalesce(sum(r.amount), 0)
    into v_rec_removed, v_rec_amount
    from public.accounts_receivable r
   where r.id = any(v_rec_ids);

  -- Mesma ordem que a tela usava: parcelas, itens, venda.
  delete from public.accounts_receivable where id = any(v_rec_ids);
  delete from public.sale_items          where sale_id = p_sale_id;
  delete from public.sales               where id = p_sale_id;

  insert into public.sale_deletions (
    sale_id, sale_short, customer_id, customer_name, sale_date, total,
    payment_method, installments, notes, items,
    restored_units, skipped_units, receivables_removed, receivables_amount,
    deleted_by
  ) values (
    v_sale.id, v_short, v_sale.customer_id, v_customer_name, v_sale.sale_date, v_sale.total,
    v_sale.payment_method, v_sale.installments, v_sale.notes, v_items,
    v_restored, v_skipped, v_rec_removed, v_rec_amount,
    auth.uid()
  );

  return jsonb_build_object(
    'ok',                  true,
    'venda',               v_short,
    'estornadas',          v_restored,
    'nao_estornadas',      v_skipped,
    'parcelas_removidas',  v_rec_removed,
    'parcelas_valor',      v_rec_amount
  );
end;
$$;

comment on function public.excluir_venda(uuid) is
  'Apaga a venda, as parcelas em aberto e os itens, estorna o estoque do que tem variacao e grava o retrato em sale_deletions. Tudo numa transacao so.';

revoke all     on function public.excluir_venda(uuid) from public;
grant  execute on function public.excluir_venda(uuid) to authenticated;
