import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Login necessário" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sessão inválida" }, 401);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: isAdmin, error: roleError } = await adminClient.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleError) {
      console.error("bubblewhats-configure-groups role error:", roleError);
      return json({ error: "Não foi possível validar permissão" }, 500);
    }
    if (!isAdmin) return json({ error: "Apenas administradores podem configurar o aparelho" }, 403);

    if (!DEVICE_ID || !BW_TOKEN) return json({ error: "BubbleWhats não configurado" }, 500);

    const webhookUrl = `${SUPABASE_URL}/functions/v1/bubblewhats-webhook`;

    let res: Response | null = null;
    let raw = "";
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(`https://${DEVICE_ID}.bubblewhats.com/config`, {
          method: "POST",
          headers: {
            Authorization: BW_TOKEN,
            Authentication: BW_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receiveMessagesWebhook: webhookUrl,
            receiveMessagesFromGroups: true,
          }),
          signal: AbortSignal.timeout(15000),
        });
        raw = await res.text();
        if (res.ok) break;
        lastErr = `HTTP ${res.status}`;
        console.error(`BubbleWhats config tentativa ${attempt}:`, res.status, raw.slice(0, 300));
        // 502/503/504 = servidor do BubbleWhats instável: vale retentar
        if (res.status < 500) break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "erro de rede";
        console.error(`BubbleWhats config tentativa ${attempt} falhou:`, lastErr);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      const msg =
        status >= 500 || status === 0
          ? "O servidor do BubbleWhats está fora do ar no momento (erro temporário do provedor). Aguarde alguns minutos e tente novamente."
          : status === 401 || status === 403
            ? "Credenciais do BubbleWhats inválidas ou expiradas."
            : "Falha ao configurar o BubbleWhats.";
      return json({ error: msg, status, details: (raw || lastErr).slice(0, 300) }, 502);
    }

    return json({ ok: true, receiveMessagesFromGroups: true, receiveMessagesWebhook: webhookUrl });
  } catch (error) {
    console.error("bubblewhats-configure-groups error:", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});