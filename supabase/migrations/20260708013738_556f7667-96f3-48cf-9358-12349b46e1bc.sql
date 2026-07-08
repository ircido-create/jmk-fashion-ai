ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS quoted_thumbnail_path text,
  ADD COLUMN IF NOT EXISTS quoted_is_status boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quoted_caption text;