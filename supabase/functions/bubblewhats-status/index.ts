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

async function bwGet(path: string) {
  try {
    const res = await fetch(`https://${DEVICE_ID}.bubblewhats.com${path}`, {
      method: "GET",
      headers: { Authorization: BW_TOKEN, Authentication: BW_TOKEN },
      signal: AbortSignal.timeout(12000),
    });
    const raw = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { parsed = raw.slice(0, 300); }
    return { ok: res.ok, status: res.status, data: parsed };
  } catch (e) {
    return { ok: false, status: 0, data: e instanceof Error ? e.message : "erro de rede" };
  }
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
    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Apenas administradores podem verificar a conexão" }, 403);

    if (!DEVICE_ID || !BW_TOKEN) return json({ error: "BubbleWhats não configurado" }, 500);

    const expectedWebhook = `${SUPABASE_URL}/functions/v1/bubblewhats-webhook`;

    const [statusRes, configRes, lastMsg] = await Promise.all([
      bwGet("/status"),
      bwGet("/config"),
      adminClient
        .from("whatsapp_messages")
        .select("created_at")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const cfg = (configRes.ok && typeof configRes.data === "object" && configRes.data) ? configRes.data as any : {};
    const registeredWebhook: string | null =
      cfg.receiveMessagesWebhook ?? cfg.webhook ?? cfg?.config?.receiveMessagesWebhook ?? null;
    const groupsEnabled: boolean | null =
      cfg.receiveMessagesFromGroups ?? cfg?.config?.receiveMessagesFromGroups ?? null;

    const st = (statusRes.ok && typeof statusRes.data === "object" && statusRes.data) ? statusRes.data as any : {};
    const rawState = String(st.status ?? st.state ?? st.connection ?? (statusRes.ok ? "desconhecido" : "indisponivel")).toLowerCase();
    const connected =
      typeof st.connected === "boolean"
        ? st.connected
        : /connected|open|online|ready|authenticated/.test(rawState);

    const lastInboundAt: string | null = (lastMsg as any)?.data?.created_at ?? null;
    const hoursSince = lastInboundAt
      ? (Date.now() - new Date(lastInboundAt).getTime()) / 3600000
      : null;

    const webhookOk = !!registeredWebhook && registeredWebhook === expectedWebhook;

    // Validade do token: 401/403 em qualquer endpoint = credencial inválida.
    // 5xx/0 = provedor indisponível (não dá para concluir nada sobre o token).
    const codes = [statusRes.status, configRes.status];
    const tokenValid: boolean | null =
      codes.some((c) => c === 401 || c === 403)
        ? false
        : codes.some((c) => c >= 200 && c < 400)
          ? true
          : null;

    // Registra falha para histórico quando a sessão está caída
    if (!connected) {
      await adminClient
        .from("whatsapp_config")
        .update({
          last_error_at: new Date().toISOString(),
          last_error_message: `Sessão BubbleWhats indisponível (status: ${rawState}). Releia o QR Code no painel do BubbleWhats.`,
        })
        .not("id", "is", null);
    }

    return json({
      ok: true,
      connected,
      rawState,
      statusHttp: statusRes.status,
      configHttp: configRes.status,
      registeredWebhook,
      expectedWebhook,
      webhookOk,
      groupsEnabled,
      lastInboundAt,
      hoursSinceLastInbound: hoursSince,
    });
  } catch (error) {
    console.error("bubblewhats-status error:", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
