// WhatsApp webhook (Meta Cloud API) - recebe mensagens e responde com a IA Monica (RAG)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const STOPWORDS = new Set([
  "a","o","as","os","de","da","do","das","dos","e","ou","um","uma","para","por","com","sem",
  "que","qual","quais","quanto","quanta","quantas","quantos","tem","ter","tenho","queria",
  "quero","gostaria","poderia","pode","me","mim","meu","minha","seu","sua","no","na","nos","nas",
  "em","ao","aos","à","às","é","são","ser","estar","está","estão","ola","olá","oi","bom","boa",
  "dia","tarde","noite","obrigado","obrigada","por favor","favor","vc","você","voce","preço",
  "preco","valor","custo","quanto","ai","aí","la","lá","aqui","esse","essa","esses","essas",
  "isso","isto","aquilo","já","ainda","só","so","mais","menos","muito","pouco","sim","não","nao"
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 8);
}

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

// RAG: busca produtos relevantes à mensagem do cliente
async function searchProducts(userMsg: string) {
  const keywords = extractKeywords(userMsg);
  let matched: any[] = [];

  if (keywords.length > 0) {
    // OR ilike em nome/descrição/categoria/sku
    const orFilter = keywords
      .flatMap((k) => [
        `name.ilike.%${k}%`,
        `description.ilike.%${k}%`,
        `category.ilike.%${k}%`,
        `sku.ilike.%${k}%`,
      ])
      .join(",");

    const { data } = await supabase
      .from("products")
      .select("name, price, category, description, sku, product_variants(size, color, quantity)")
      .eq("active", true)
      .or(orFilter)
      .limit(15);
    matched = data ?? [];
  }

  // Catálogo geral (top 20) como fallback / contexto amplo
  const { data: general } = await supabase
    .from("products")
    .select("name, price, category, description, sku, product_variants(size, color, quantity)")
    .eq("active", true)
    .limit(20);

  // dedup por nome
  const seen = new Set<string>();
  const all = [...matched, ...(general ?? [])].filter((p: any) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  return { matched, all };
}

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "-";
  // iso: "2026-04-10" -> "10/04/2026"
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Heurísticas para extrair dados de cadastro da mensagem do cliente
function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

function looksLikeAddress(text: string): boolean {
  // Tem número + alguma palavra típica de endereço, ou CEP
  const t = text.toLowerCase();
  if (/\d{5}-?\d{3}/.test(t)) return true; // CEP
  const hasNumber = /\d/.test(t);
  const hasKeyword = /(rua|av\.?|avenida|travessa|alameda|estrada|rodovia|bairro|quadra|n[º°ºo]|cep|cidade)/i.test(t);
  return hasNumber && hasKeyword && t.length >= 15;
}

function looksLikeName(text: string): boolean {
  // 2+ palavras alfabéticas, sem dígitos, sem @, curto
  const t = text.trim();
  if (t.length > 80 || t.length < 3) return false;
  if (/[@\d]/.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ'`-]{2,}$/.test(w));
  return words.length >= 1 && words.length <= 6;
}

function missingFields(c: any | null): string[] {
  const miss: string[] = [];
  if (!c?.name || c.name.trim() === "" || c.name === c.phone) miss.push("nome");
  if (!c?.address || c.address.trim() === "") miss.push("endereço");
  if (!c?.email || c.email.trim() === "") miss.push("email");
  return miss;
}

// Tenta auto-cadastrar a partir do texto + último campo solicitado (do histórico)
async function autoUpdateCustomer(phone: string, customer: any | null, userMsg: string, lastAskedField: string | null) {
  const updates: any = {};
  const text = userMsg.trim();

  const email = extractEmail(text);
  if (email && (!customer?.email || customer.email.trim() === "")) {
    updates.email = email;
  }

  // Se a IA acabou de pedir um campo específico, assume que a resposta é esse campo
  if (lastAskedField === "nome" && (!customer?.name || customer.name === customer.phone)) {
    if (looksLikeName(text)) updates.name = text;
  } else if (lastAskedField === "endereço" && (!customer?.address || customer.address.trim() === "")) {
    if (text.length >= 10) updates.address = text;
  } else {
    // Heurística geral
    if ((!customer?.address || customer.address.trim() === "") && looksLikeAddress(text)) {
      updates.address = text;
    } else if ((!customer?.name || customer.name === customer.phone) && looksLikeName(text) && !email) {
      updates.name = text;
    }
  }

  if (Object.keys(updates).length === 0) return customer;

  if (customer) {
    const { data } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", customer.id)
      .select("id, name, address, email")
      .maybeSingle();
    return data ?? customer;
  } else {
    const { data } = await supabase
      .from("customers")
      .insert({ phone, name: updates.name ?? phone, address: updates.address ?? null, email: updates.email ?? null })
      .select("id, name, address, email")
      .maybeSingle();
    // vincula conversa
    if (data) {
      await supabase.from("whatsapp_conversations").update({ customer_id: data.id }).eq("customer_phone", phone);
    }
    return data;
  }
}

// Detecta qual campo a IA pediu na última mensagem outbound
function detectLastAskedField(history: any[]): string | null {
  const lastBot = [...history].reverse().find((m) => m.direction === "outbound");
  if (!lastBot) return null;
  const c = lastBot.content.toLowerCase();
  if (/(qual.*(seu|teu).*nome|me diz.*nome|qual.*nome.*querida)/.test(c)) return "nome";
  if (/(endere[çc]o|rua|cep|bairro)/.test(c)) return "endereço";
  if (/(e-?mail)/.test(c)) return "email";
  return null;
}

async function buildContext(phone: string, userMsg: string, history: any[]) {
  const { matched, all } = await searchProducts(userMsg);

  const { data: rawCustomer } = await supabase
    .from("customers")
    .select("id, name, address, email")
    .eq("phone", phone)
    .maybeSingle();

  const lastAsked = detectLastAskedField(history);
  const customer = await autoUpdateCustomer(phone, rawCustomer, userMsg, lastAsked);

  let debts: any[] = [];
  if (customer) {
    const { data } = await supabase
      .from("accounts_receivable")
      .select("description, amount, due_date, status")
      .eq("customer_id", customer.id)
      .neq("status", "pago");
    debts = (data ?? []).map((d: any) => ({ ...d, due_date: formatDateBR(d.due_date) }));
  }

  const missing = missingFields(customer);

  return { matched, all, customer, debts, missing };
}

function formatProducts(list: any[]) {
  if (list.length === 0) return "(nenhum)";
  return list
    .map((p: any) => {
      const vars = (p.product_variants ?? [])
        .map((v: any) => `${v.size ?? "-"}/${v.color ?? "-"} (estoque: ${v.quantity})`)
        .join("; ");
      return `• ${p.name} (SKU ${p.sku ?? "-"}) — R$ ${p.price} — ${p.category ?? ""} — Variações: ${vars || "única"}`;
    })
    .join("\n");
}

async function callAI(systemPrompt: string, history: any[], userMsg: string, ctx: any, isFirstMessage: boolean) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const matchInfo =
    ctx.matched.length > 0
      ? `Produtos que correspondem à pergunta do cliente:\n${formatProducts(ctx.matched)}`
      : `⚠️ Nenhum produto do catálogo corresponde à pergunta atual do cliente. Se ele pediu um modelo específico (ex: "vestido amanda"), diga que NÃO temos esse modelo e ofereça alternativas reais da lista geral abaixo.`;

  const contextText = `
=== ESTADO DA CONVERSA ===
PRIMEIRA_MENSAGEM=${isFirstMessage ? "true" : "false"}
${isFirstMessage
  ? "→ Esta é a PRIMEIRA mensagem desta conversa. Cumprimente e se apresente UMA vez."
  : "→ Conversa JÁ EM ANDAMENTO. NÃO se apresente, NÃO diga seu nome, NÃO diga 'aqui é da JMK'. Vá direto ao ponto."}

=== CATÁLOGO COMPLETO (use SOMENTE estes produtos, nada além) ===
${formatProducts(ctx.all)}

=== BUSCA NA PERGUNTA ATUAL ===
${matchInfo}

=== CLIENTE ===
${ctx.customer
  ? `Nome: ${ctx.customer.name ?? "(faltando)"} | Endereço: ${ctx.customer.address ?? "(faltando)"} | E-mail: ${ctx.customer.email ?? "(faltando)"}`
  : "Cliente NÃO cadastrado."}
CAMPOS FALTANDO: ${ctx.missing.length === 0 ? "nenhum (cadastro completo — NÃO pergunte dados pessoais)" : ctx.missing.join(", ") + " — peça APENAS UM por mensagem, na ordem: nome → endereço → email. NÃO fale de produtos enquanto faltar dados."}

=== DÍVIDAS PENDENTES (FONTE DA VERDADE — ignore datas/valores do histórico) ===
${ctx.debts.length === 0 ? "Nenhuma" : ctx.debts.map((d: any) =>
  `• ${d.description ?? "Compra"} — R$ ${d.amount} — vence ${d.due_date} — status ${d.status}`
).join("\n")}
`.trim();

  const messages = [
    { role: "system", content: systemPrompt + "\n\n" + contextText },
    ...history.slice(-10).map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
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
    if (!conv) {
      console.error("Falha ao criar/obter conversa para", fromPhone);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const { error: insErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: text,
    });
    if (insErr) console.error("insert inbound error:", insErr);

    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);

    // Primeira mensagem = só existe a inbound que acabamos de inserir agora
    const isFirstMessage = (history?.length ?? 0) <= 1;

    const ctx = await buildContext(fromPhone, text, history ?? []);
    const reply = await callAI(ai?.system_prompt ?? "", history ?? [], text, ctx, isFirstMessage);

    await sendWhatsApp(fromPhone, reply, cfg);
    const { error: outErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      content: reply,
    });
    if (outErr) console.error("insert outbound error:", outErr);
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
