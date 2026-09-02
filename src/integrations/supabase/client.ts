import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Era brokeredPreviewStorage(), que repassava a sessão ao editor do Lovable por
    // postMessage quando a página rodava dentro do preview deles. Fora daqueles
    // domínios a função já devolvia localStorage, então o comportamento aqui é o
    // mesmo de antes — apenas sem o desvio.
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
