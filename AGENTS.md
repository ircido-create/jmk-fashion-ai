# Architecture rules

- Keep cover-replacement gallery logic in the dependency-free `supabase/functions/_shared/product-gallery.ts`, reused by the photo picker and its edge function, so browser uploads and supplier downloads cannot diverge.