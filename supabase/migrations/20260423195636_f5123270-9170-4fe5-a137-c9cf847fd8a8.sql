update public.whatsapp_messages
set content = regexp_replace(
  content,
  '\s*\n?\[\s*(?:⚠️\s*)?\d+\s*foto\(s\)[^\]]*\]',
  '',
  'g'
)
where content ~ '\[\s*(?:⚠️\s*)?\d+\s*foto\(s\)';