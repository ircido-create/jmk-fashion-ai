// Verificação de identidade e papel para edge functions.
//
// A checagem estava copiada em admin-create-user e admin-set-password, e faltava
// nas outras funções privilegiadas — merge-customers apagava cliente com JWT de
// qualquer vendedor. Centralizado aqui para não haver função privilegiada sem
// verificação por esquecimento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type Caller = { id: string; isAdmin: boolean };

/**
 * Valida o JWT do chamador e resolve o papel.
 * Lança uma Response pronta (401/403) quando recusa — o handler devolve com
 * `if (e instanceof Response) return e;`.
 */
export async function requireUser(req: Request): Promise<Caller> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw deny(401, "unauthorized");

  const userClient = createClient(URL_, ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw deny(401, "unauthorized");

  const admin = createClient(URL_, SERVICE);
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: data.user.id,
    _role: "admin",
  });
  return { id: data.user.id, isAdmin: !!isAdmin };
}

export async function requireAdmin(req: Request): Promise<Caller> {
  const caller = await requireUser(req);
  if (!caller.isAdmin) throw deny(403, "forbidden");
  return caller;
}
