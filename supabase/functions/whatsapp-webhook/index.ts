// WhatsApp webhook (Meta Cloud API) - recebe mensagens e responde com IA
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function loadConfig() {
  const { data } = await supabase.from("whatsapp_config").select("*").maybeSingle();
  return data;
}

async function loadAISettings() {
  const { data } = await supabase.from("ai_settings").select("*").maybeSingle();
  return data;
}

async function sendWhatsApp(to: string, text: string, cfg: any) {
  const url = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) console.error("Meta send error:", res.status, await res.text());
}

async function getOrCreateConversation(phone: string) {
  const { data: existing } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("customer_phone", phone)
    .maybeSingle();
  if (existing) return existing;

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  const { data: created } = await supabase
    .from("whatsapp_conversations")
    .insert({ customer_phone: phone, customer_id: customer?.id ?? null })
    .select()
    .single();
  return created;
}

async function buildContext(phone: string) {
  // Catálogo (top 30 produtos ativos)
  const { data: products } = await supabase
    .from("products")
    .select("name, price, category, description, sku, product_variants(size, color, quantity)")
    .eq("active", true)
    .limit(30);

  // Cliente + dívidas
  const { data: customer } = await supabase
    .from("customers")
    .select("id, name")
    .eq("phone", phone)
    .maybeSingle();

  let debts: any[] = [];
  if (customer) {
    const { data } = await supabase
      .from("accounts_receivable")
      .select("description, amount, due_date, status")
      .eq("customer_id", customer.id)
      .neq("status", "pago");
    debts = data ?? [];
  }

  return { products: products ?? [], customer, debts };
}

async function callAI(systemPrompt: string, history: any[], userMsg: string, ctx: any) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const contextText = `
=== CATÁLOGO DA LOJA ===
${ctx.products.map((p: any) => {
  const vars = (p.product_variants ?? [])
    .map((v: any) => `${v.size ?? ""}/${v.color ?? ""} (estoque: ${v.quantity})`)
    .join("; ");
  return `• ${p.name} (SKU ${p.sku ?? "-"}) — R$ ${p.price} — ${p.category ?? ""} — Variações: ${vars || "única"}`;
}).join("\n")}

=== CLIENTE ===
${ctx.customer ? `Nome: ${ctx.customer.name}` : "Cliente não cadastrado"}

=== DÍVIDAS PENDENTES ===
${ctx.debts.length === 0 ? "Nenhuma" : ctx.debts.map((d: any) =>
  `• ${d.description ?? "Compra"} — R$ ${d.amount} — vence ${d.due_date} — status ${d.status}`
).join("\n")}
`.trim();

  const messages = [
    { role: "system", content: systemPrompt + "\n\n" + contextText },
    ...history.slice(-10).map((m: any) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: userMsg },
  ];

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
  });

  if (!resp.ok) {
    console.error("AI error", resp.status, await resp.text());
    return "Desculpe, estou com uma instabilidade no momento. Pode tentar novamente em instantes? 💕";
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "Desculpe, não entendi. Pode reformular?";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // Verificação inicial do webhook (Meta)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const cfg = await loadConfig();
    if (mode === "subscribe" && token && cfg?.verify_token && token === cfg.verify_token) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  try {
    const body = await req.json();
    const cfg = await loadConfig();
    const ai = await loadAISettings();

    if (!cfg?.enabled || !cfg.access_token || !cfg.phone_number_id) {
      console.log("WhatsApp desabilitado ou sem config");
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return new Response("ok", { status: 200, headers: corsHeaders });

    const fromPhone: string = message.from;
    const text: string = message.text?.body ?? "";
    if (!text) return new Response("ok", { status: 200, headers: corsHeaders });

    const conv = await getOrCreateConversation(fromPhone);

    // salvar mensagem recebida
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "in",
      content: text,
    });

    // histórico
    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);

    const ctx = await buildContext(fromPhone);
    const reply = await callAI(ai?.system_prompt ?? "", history ?? [], text, ctx);

    await sendWhatsApp(fromPhone, reply, cfg);
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "out",
      content: reply,
    });
    await supabase
      .from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("webhook error", e);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
