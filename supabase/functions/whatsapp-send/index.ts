// Envio manual de mensagem WhatsApp via BubbleWhats API
// Docs: https://{DEVICE_ID}.bubblewhats.com/send-message
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, message, save_history = false } = await req.json();
    if (!to || !message) {
      return new Response(JSON.stringify({ error: "to e message obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deviceId = Deno.env.get("BUBBLEWHATS_DEVICE_ID");
    const bwToken = Deno.env.get("BUBBLEWHATS_TOKEN");
    if (!deviceId || !bwToken) {
      return new Response(JSON.stringify({ error: "BubbleWhats não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jid = String(to).replace(/\D/g, "");
    const url = `https://${deviceId}.bubblewhats.com/send-message`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: bwToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jid, message }),
    });
    const text = await res.text();
    let result: any; try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok) {
      console.error("BubbleWhats send error:", res.status, text);
      const upstreamDown = res.status >= 500 || res.status === 502 || res.status === 503 || res.status === 504;
      return new Response(JSON.stringify({
        success: false,
        error: upstreamDown ? "BubbleWhats indisponível no momento (upstream 502). Tente novamente em instantes." : result,
        upstream_status: res.status,
      }), {
        status: 200, // evita 502 no cliente/tela em branco
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (save_history) {
      let { data: conv } = await admin
        .from("whatsapp_conversations")
        .select("*")
        .eq("customer_phone", jid)
        .maybeSingle();

      if (!conv) {
        const { data: customer } = await admin
          .from("customers").select("id").eq("phone", jid).maybeSingle();
        const { data: created } = await admin
          .from("whatsapp_conversations")
          .insert({ customer_phone: jid, customer_id: customer?.id ?? null })
          .select().single();
        conv = created;
      }

      if (conv) {
        await admin.from("whatsapp_messages").insert({
          conversation_id: conv.id,
          direction: "outbound",
          content: message,
        });
        await admin.from("whatsapp_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conv.id);
      }
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
