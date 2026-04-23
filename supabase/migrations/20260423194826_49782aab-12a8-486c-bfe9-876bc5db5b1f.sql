insert into storage.buckets (id, name, public)
values ('favorite-stickers', 'favorite-stickers', true)
on conflict (id) do nothing;

create policy "Public read favorite stickers"
on storage.objects for select
using (bucket_id = 'favorite-stickers');

create policy "Authenticated upload favorite stickers"
on storage.objects for insert
to authenticated
with check (bucket_id = 'favorite-stickers');

create policy "Authenticated delete favorite stickers"
on storage.objects for delete
to authenticated
using (bucket_id = 'favorite-stickers');

create table public.favorite_stickers (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  public_url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.favorite_stickers enable row level security;

create policy "Authenticated read favorite stickers"
on public.favorite_stickers for select
to authenticated
using (true);

create policy "Authenticated insert favorite stickers"
on public.favorite_stickers for insert
to authenticated
with check (auth.uid() = created_by);

create policy "Authenticated delete own favorite stickers"
on public.favorite_stickers for delete
to authenticated
using (auth.uid() = created_by);

create index favorite_stickers_created_at_idx on public.favorite_stickers (created_at desc);