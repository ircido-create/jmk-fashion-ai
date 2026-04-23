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

// Registra falha de auth (token expirado) na tabela de config
async function recordMetaError(status: number, body: string) {
  try {
    const isAuth = status === 401 || /OAuthException|expired|access token/i.test(body);
    if (!isAuth) return;
    const msg = body.slice(0, 500);
    await supabase
      .from("whatsapp_config")
      .update({ last_error_at: new Date().toISOString(), last_error_message: msg })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    console.error("⚠️ TOKEN WHATSAPP EXPIRADO/INVÁLIDO — atualize em Configurações → WhatsApp");
  } catch (e) {
    console.error("recordMetaError failed:", e);
  }
}

// Limpa marca de erro quando uma chamada à Meta volta a funcionar
async function clearMetaError() {
  try {
    await supabase
      .from("whatsapp_config")
      .update({ last_error_at: null, last_error_message: null })
      .not("last_error_at", "is", null);
  } catch {
    /* noop */
  }
}

// Baixa um media do WhatsApp Cloud API e retorna { bytes, base64, mimeType }
async function downloadWhatsAppMedia(mediaId: string, cfg: any): Promise<{ bytes: Uint8Array; base64: string; mimeType: string } | null> {
  try {
    // 1) pega URL temporária
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    if (!metaRes.ok) {
      const errBody = await metaRes.text();
      console.error("media meta error:", metaRes.status, errBody);
      await recordMetaError(metaRes.status, errBody);
      return null;
    }
    const meta = await metaRes.json();
    const mediaUrl = meta?.url;
    const mimeType = meta?.mime_type ?? "application/octet-stream";
    if (!mediaUrl) return null;

    // 2) baixa o binário
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    if (!fileRes.ok) {
      console.error("media file error:", fileRes.status);
      return null;
    }
    const buf = await fileRes.arrayBuffer();

    // 3) converte para base64 em chunks (evita stack overflow)
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
    }
    const base64 = btoa(binary);
    return { bytes, base64, mimeType };
  } catch (e) {
    console.error("downloadWhatsAppMedia error:", e);
    return null;
  }
}

function inboundExt(mime: string): string {
  const m: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/webm": "webm",
    "application/pdf": "pdf",
    "video/mp4": "mp4", "video/3gpp": "3gp",
  };
  return m[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

// Salva mídia recebida no bucket whatsapp-media e retorna o storage path
async function saveInboundMedia(
  bytes: Uint8Array,
  mimeType: string,
  fromPhone: string,
  suggestedName?: string,
): Promise<string | null> {
  try {
    const ext = inboundExt(mimeType);
    const safe = suggestedName?.replace(/[^\w.-]/g, "_") ?? `file.${ext}`;
    const finalName = safe.includes(".") ? safe : `${safe}.${ext}`;
    const path = `inbound/${fromPhone}/${Date.now()}-${finalName}`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) {
      console.error("saveInboundMedia upload error:", error);
      return null;
    }
    return path;
  } catch (e) {
    console.error("saveInboundMedia error:", e);
    return null;
  }
}

// Transcreve áudio usando Lovable AI (Gemini multimodal)
async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva fielmente este áudio em português brasileiro. Responda APENAS com a transcrição, sem comentários, sem aspas, sem prefixos.",
              },
              {
                type: "input_audio",
                input_audio: { data: base64, format: mimeType.includes("mp3") ? "mp3" : "ogg" },
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("transcribe error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error("transcribeAudio error:", e);
    return null;
  }
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
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta send error:", res.status, body);
    await recordMetaError(res.status, body);
  } else {
    await clearMetaError();
  }
}

function inferExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mimeType] ?? "jpg";
}

async function uploadMetaMediaFromUrl(imageUrl: string, cfg: any): Promise<string | null> {
  try {
    const normalizedUrl = imageUrl.trim();
    const imageRes = await fetch(normalizedUrl);
    if (!imageRes.ok) {
      console.error("Image download error:", imageRes.status, normalizedUrl);
      return null;
    }

    const mimeType = (imageRes.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith("image/")) {
      console.error("Invalid image content type:", mimeType, normalizedUrl);
      return null;
    }

    const fileBuffer = await imageRes.arrayBuffer();
    const fileNameFromUrl = normalizedUrl.split("/").pop()?.split("?")[0]?.trim();
    const fileName = fileNameFromUrl && fileNameFromUrl.includes(".")
      ? fileNameFromUrl
      : `product-image.${inferExtensionFromMimeType(mimeType)}`;

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);

    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
      },
      body: form,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      console.error("Meta media upload error:", uploadRes.status, "url=", normalizedUrl, body);
      await recordMetaError(uploadRes.status, body);
      return null;
    }

    const uploadData = await uploadRes.json();
    const mediaId = uploadData?.id;
    if (!mediaId) {
      console.error("Meta media upload returned no id:", uploadData);
      return null;
    }

    await clearMetaError();
    return mediaId;
  } catch (e) {
    console.error("uploadMetaMediaFromUrl error:", imageUrl, e);
    return null;
  }
}

async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption: string,
  cfg: any,
  conversationId?: string,
): Promise<boolean> {
  const mediaId = await uploadMetaMediaFromUrl(imageUrl, cfg);
  if (!mediaId) return false;

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
      type: "image",
      image: { id: mediaId, caption: caption.slice(0, 1024) },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta image send error:", res.status, "mediaId=", mediaId, body);
    await recordMetaError(res.status, body);
    return false;
  }
  await clearMetaError();

  // Registra a imagem enviada como uma mensagem outbound (com media_path)
  // para que apareça no painel de conversa — assim como as figurinhas/áudios.
  if (conversationId) {
    try {
      const imgRes = await fetch(imageUrl.trim());
      if (imgRes.ok) {
        const mime = (imgRes.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const fileNameFromUrl = imageUrl.trim().split("/").pop()?.split("?")[0]?.replace(/[^\w.-]/g, "_") ?? `image.${ext}`;
        const finalName = fileNameFromUrl.includes(".") ? fileNameFromUrl : `${fileNameFromUrl}.${ext}`;
        const path = `outbound/${to}/${Date.now()}-image-${finalName}`;
        const { error: upErr } = await supabase.storage
          .from("whatsapp-media")
          .upload(path, buf, { contentType: mime, upsert: false });
        if (upErr) {
          console.error("save outbound image upload error:", upErr);
        } else {
          const { error: insErr } = await supabase.from("whatsapp_messages").insert({
            conversation_id: conversationId,
            direction: "outbound",
            content: caption?.trim() ? caption : "[📷 Imagem]",
            media_path: path,
            media_type: "image",
            media_mime: mime,
            media_filename: finalName,
          });
          if (insErr) console.error("insert outbound image msg error:", insErr);
        }
      } else {
        console.error("download image for storage failed:", imgRes.status, imageUrl);
      }
    } catch (e) {
      console.error("registerOutboundImage error:", e);
    }
  }

  return true;
}

// Detecta se a cliente pediu foto/imagem
function asksForPhoto(text: string): boolean {
  const t = norm(text);
  return /(foto|fotos|imagem|imagens|figura|me manda.*foto|tem foto|tem imagem|posso ver|me mostra|manda.*foto)/.test(t);
}

// Frases genéricas de "me manda foto/de novo" — sem produto específico
function isGenericPhotoRequest(text: string): boolean {
  const t = norm(text);
  // Remove os verbos de pedir foto e vê o que sobra
  const stripped = t
    .replace(/(foto|fotos|imagem|imagens|figura|figuras)/g, "")
    .replace(/(me manda|me envia|me mostra|envia|manda|mostra|posso ver|tem|pode|poderia|novamente|de novo|outra vez|tambem|também)/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return stripped.length < 3; // sobrou quase nada → é genérico
}

// Junta a mensagem atual com mensagens anteriores do cliente para inferir o produto pedido
function buildPhotoQueryContext(userMsg: string, history: any[]): string {
  if (!isGenericPhotoRequest(userMsg)) return userMsg;
  // Pega as últimas 6 mensagens do CLIENTE (inbound) — exclui a atual que pode já estar no history
  const inbounds = history.filter((m: any) => m.direction === "inbound").slice(-6);
  const ctxText = inbounds.map((m: any) => m.content).join(" ");
  // Também aproveita a última resposta do bot (pode mencionar o nome do produto que ele já enviou)
  const lastBot = [...history].reverse().find((m: any) => m.direction === "outbound");
  return `${ctxText} ${lastBot?.content ?? ""} ${userMsg}`.trim();
}

// Busca variações com foto que correspondam à mensagem (com fallback para o contexto da conversa)
async function findPhotoMatches(
  userMsg: string,
  supplier: string | null,
  history: any[] = [],
): Promise<{ url: string; caption: string }[]> {
  const queryText = buildPhotoQueryContext(userMsg, history);
  const keywords = extractKeywords(queryText);
  let q = supabase
    .from("products")
    .select("name, supplier, product_variants(size, color, image_url, quantity)")
    .eq("active", true)
    .limit(20);
  if (supplier) q = q.eq("supplier", supplier);
  if (keywords.length > 0) {
    q = q.or(keywords.flatMap((k) => [`name.ilike.%${k}%`, `description.ilike.%${k}%`, `category.ilike.%${k}%`, `sku.ilike.%${k}%`]).join(","));
  }
  const { data } = await q;
  const out: { url: string; caption: string }[] = [];
  for (const p of data ?? []) {
    for (const v of (p as any).product_variants ?? []) {
      if (v.image_url) {
        const variantLabel = [v.size, v.color].filter(Boolean).join(" / ");
        out.push({ url: v.image_url, caption: `${(p as any).name}${variantLabel ? ` — ${variantLabel}` : ""}` });
        if (out.length >= 4) return out;
      }
    }
  }
  return out;
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

// Normaliza para comparação (sem acento, minúsculo, sem espaços extras)
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Detecta se o cliente mencionou um fornecedor específico na mensagem
async function detectSupplier(userMsg: string): Promise<string | null> {
  const { data } = await supabase
    .from("products")
    .select("supplier")
    .eq("active", true)
    .not("supplier", "is", null);
  const suppliers = Array.from(
    new Set((data ?? []).map((r: any) => r.supplier).filter((s: any) => !!s && s.trim() !== ""))
  );
  const msg = norm(userMsg);
  for (const s of suppliers) {
    const ns = norm(s);
    if (msg.includes(ns)) return s;
    const tokens = ns.split(/\s+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => msg.includes(t))) return s;
  }
  return null;
}

// RAG: busca produtos relevantes à mensagem do cliente, opcionalmente restrito a um fornecedor
async function searchProducts(userMsg: string, supplier: string | null) {
  const keywords = extractKeywords(userMsg);
  let matched: any[] = [];

  if (keywords.length > 0) {
    const orFilter = keywords
      .flatMap((k) => [
        `name.ilike.%${k}%`,
        `description.ilike.%${k}%`,
        `category.ilike.%${k}%`,
        `sku.ilike.%${k}%`,
      ])
      .join(",");

    let q = supabase
      .from("products")
      .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
      .eq("active", true)
      .or(orFilter)
      .limit(20);
    if (supplier) q = q.eq("supplier", supplier);
    const { data } = await q;
    matched = data ?? [];
  }

  // Catálogo geral — restringe ao fornecedor se mencionado
  let gq = supabase
    .from("products")
    .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
    .eq("active", true)
    .limit(supplier ? 50 : 20);
  if (supplier) gq = gq.eq("supplier", supplier);
  const { data: general } = await gq;

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
  const supplierMentioned = await detectSupplier(userMsg);
  const { matched, all } = await searchProducts(userMsg, supplierMentioned);

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

  return { matched, all, customer, debts, missing, supplierMentioned };
}

function formatProducts(list: any[]) {
  if (list.length === 0) return "(nenhum)";
  return list
    .map((p: any) => {
      const vars = (p.product_variants ?? [])
        .map((v: any) => `${v.size ?? "-"}/${v.color ?? "-"} (estoque: ${v.quantity})`)
        .join("; ");
      return `• ${p.name} (SKU ${p.sku ?? "-"}) — R$ ${p.price} — ${p.category ?? ""} — Fornecedor: ${p.supplier ?? "-"} — Variações: ${vars || "única"}`;
    })
    .join("\n");
}

async function callAI(systemPrompt: string, history: any[], userMsg: string, ctx: any, isFirstMessage: boolean, pix: { key?: string | null; type?: string | null; recipient?: string | null }) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const matchInfo =
    ctx.matched.length > 0
      ? `Produtos que correspondem à pergunta do cliente:\n${formatProducts(ctx.matched)}`
      : `⚠️ Nenhum produto do catálogo corresponde à pergunta atual do cliente. Se ele pediu um modelo específico (ex: "vestido amanda"), diga que NÃO temos esse modelo e ofereça alternativas reais da lista geral abaixo.`;

  const supplierBlock = ctx.supplierMentioned
    ? `→ O cliente mencionou o FORNECEDOR "${ctx.supplierMentioned}". Mostre APENAS produtos deste fornecedor (a lista abaixo já está filtrada). Se ele pedir algo de outro fornecedor depois, troque o filtro.`
    : `→ Nenhum fornecedor específico mencionado. Use o catálogo geral.`;

  const pixBlock = pix.key
    ? `Chave PIX configurada: ${pix.key}
Tipo: ${pix.type ?? "não informado"}${pix.recipient ? `\nRecebedor: ${pix.recipient}` : ""}

→ Quando a cliente disser que QUER PAGAR, FECHAR PEDIDO, FINALIZAR COMPRA, perguntar "como pago?", "qual a forma de pagamento?", "como faço o pagamento?", ou similar:
   1. Sugira pagamento via PIX de forma natural e calorosa.
   2. Envie a chave PIX EXATAMENTE como está acima (sem alterar dígitos), informando o tipo e o recebedor (se houver).
   3. Peça que ela envie o comprovante após o pagamento.
   4. Formato sugerido (adapte o tom):
      "Pode pagar via PIX 💕
      Chave (${pix.type ?? "PIX"}): ${pix.key}${pix.recipient ? `\n      Recebedor: ${pix.recipient}` : ""}
      Me manda o comprovante quando pagar, por favor 🥰"
   5. NÃO invente outras chaves PIX, contas bancárias ou formas de pagamento.`
    : `→ Nenhuma chave PIX configurada. Se a cliente perguntar sobre pagamento, diga que vai verificar com a equipe e retorna em breve.`;

  const contextText = `
=== ESTADO DA CONVERSA ===
PRIMEIRA_MENSAGEM=${isFirstMessage ? "true" : "false"}
${isFirstMessage
  ? "→ Esta é a PRIMEIRA mensagem desta conversa. Cumprimente e se apresente UMA vez."
  : "→ Conversa JÁ EM ANDAMENTO. NÃO se apresente, NÃO diga seu nome, NÃO diga 'aqui é da JMK'. Vá direto ao ponto."}

=== FOTOS ===
Se a cliente pediu foto/imagem ("me manda foto", "tem foto?"), o sistema JÁ ENVIOU as imagens disponíveis automaticamente em mensagens separadas ANTES desta sua resposta. Apenas comente brevemente ("Mandei aqui ó 💕", "Olha que lindos") — NÃO descreva foto que não existe e NÃO prometa enviar foto. Se não houver foto cadastrada para o item pedido, avise gentilmente que vai verificar com a equipe.

=== FILTRO POR FORNECEDOR ===
${supplierBlock}

=== CATÁLOGO ${ctx.supplierMentioned ? `(filtrado por fornecedor "${ctx.supplierMentioned}")` : "COMPLETO"} — use SOMENTE estes produtos ===
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

=== PAGAMENTO (PIX) ===
${pixBlock}
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
    let text: string = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? message.video?.caption ?? "";

    // === MÍDIA RECEBIDA (image, audio, voice, document, video, sticker) ===
    let inboundMedia: {
      kind: "image" | "audio" | "document" | "video" | "sticker";
      mediaId: string;
      filename?: string;
    } | null = null;

    if (message.type === "audio" || message.type === "voice") {
      const mediaId = message.audio?.id ?? message.voice?.id;
      if (mediaId) inboundMedia = { kind: "audio", mediaId };
    } else if (message.type === "image") {
      const mediaId = message.image?.id;
      if (mediaId) inboundMedia = { kind: "image", mediaId };
    } else if (message.type === "document") {
      const mediaId = message.document?.id;
      if (mediaId) inboundMedia = { kind: "document", mediaId, filename: message.document?.filename };
    } else if (message.type === "video") {
      const mediaId = message.video?.id;
      if (mediaId) inboundMedia = { kind: "video", mediaId };
    } else if (message.type === "sticker") {
      const mediaId = message.sticker?.id;
      if (mediaId) inboundMedia = { kind: "sticker", mediaId };
    }

    let savedMediaPath: string | null = null;
    let savedMediaMime: string | null = null;
    let savedMediaName: string | null = null;
    let audioFailureNote: string | null = null;

    if (inboundMedia) {
      const media = await downloadWhatsAppMedia(inboundMedia.mediaId, cfg);
      if (media) {
        savedMediaPath = await saveInboundMedia(media.bytes, media.mimeType, fromPhone, inboundMedia.filename);
        savedMediaMime = media.mimeType;
        savedMediaName = inboundMedia.filename ?? null;

        // Áudio: também transcreve para alimentar a IA
        if (inboundMedia.kind === "audio" && !text) {
          const transcript = await transcribeAudio(media.base64, media.mimeType);
          if (transcript) {
            text = transcript;
            console.log("Áudio transcrito:", text);
          } else if (!savedMediaPath) {
            audioFailureNote = "[🎤 Áudio recebido — falha ao transcrever]";
          }
        }
      } else if (inboundMedia.kind === "audio") {
        audioFailureNote = "[🎤 Áudio recebido — falha ao baixar da Meta (token pode ter expirado)]";
      }
    }

    // Se houve falha de áudio sem nada salvo nem texto, registra e avisa
    if (audioFailureNote && !text && !savedMediaPath) {
      const conv = await getOrCreateConversation(fromPhone);
      if (conv) {
        await supabase.from("whatsapp_messages").insert({
          conversation_id: conv.id,
          direction: "inbound",
          content: audioFailureNote,
        });
        await supabase
          .from("whatsapp_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conv.id);
      }
      await sendWhatsApp(
        fromPhone,
        "Desculpe, não consegui ouvir seu áudio 😅 Pode escrever a mensagem ou gravar novamente, por favor? 💕",
        cfg
      );
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Sem texto e sem mídia salva → ignora
    if (!text && !savedMediaPath) return new Response("ok", { status: 200, headers: corsHeaders });

    const conv = await getOrCreateConversation(fromPhone);
    if (!conv) {
      console.error("Falha ao criar/obter conversa para", fromPhone);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Inserção da mensagem inbound (com mídia se houver)
    const labelByKind: Record<string, string> = {
      image: "[📷 Imagem]",
      audio: "[🎤 Áudio]",
      document: "[📎 Documento]",
      video: "[🎥 Vídeo]",
      sticker: "[🌟 Figurinha]",
    };
    const inboundContent = text?.trim() ? text : (inboundMedia ? labelByKind[inboundMedia.kind] : "");

    const { error: insErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: inboundContent,
      media_path: savedMediaPath,
      media_type: inboundMedia?.kind ?? null,
      media_mime: savedMediaMime,
      media_filename: savedMediaName,
    });
    if (insErr) console.error("insert inbound error:", insErr);

    // Se não temos texto nenhum (foto sem caption por ex.), não chama a IA — só registra
    if (!text) {
      await supabase
        .from("whatsapp_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conv.id);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);

    // Primeira mensagem = só existe a inbound que acabamos de inserir agora
    const isFirstMessage = (history?.length ?? 0) <= 1;

    const ctx = await buildContext(fromPhone, text, history ?? []);
    const reply = await callAI(
      ai?.system_prompt ?? "",
      history ?? [],
      text,
      ctx,
      isFirstMessage,
      { key: ai?.pix_key, type: ai?.pix_key_type, recipient: ai?.pix_recipient_name }
    );

    // Se a cliente pediu foto, envia imagens antes da resposta de texto.
    // As fotos são gravadas como mensagens próprias (com media_path) pelo
    // sendWhatsAppImage → registerOutboundMedia, então NÃO precisamos
    // adicionar texto extra ("[N foto(s) enviada(s): ...]") na mensagem
    // de resposta — isso só polui o painel.
    let photoFailed = false;
    if (asksForPhoto(text)) {
      const photos = await findPhotoMatches(text, ctx.supplierMentioned, history ?? []);
      const sent: { caption: string }[] = [];
      const failed: { caption: string }[] = [];
      for (const ph of photos) {
        const ok = await sendWhatsAppImage(fromPhone, ph.url, ph.caption, cfg);
        if (ok) sent.push(ph); else failed.push(ph);
      }
      if (sent.length > 0) {
        console.log(`[webhook] ${sent.length} foto(s) enviada(s):`, sent.map((p) => p.caption).join(", "));
      }
      if (failed.length > 0) {
        console.warn(`[webhook] ${failed.length} foto(s) falharam:`, failed.map((p) => p.caption).join(", "));
      }
      if (photos.length > 0 && sent.length === 0) {
        photoFailed = true;
      }
    }

    let finalReply = reply;
    if (photoFailed) {
      finalReply = `Ah, desculpa! Tentei te mandar as fotos mas não consegui enviar agora 😅 Mas posso te descrever:\n\n${reply}`;
    }
    await sendWhatsApp(fromPhone, finalReply, cfg);
    const { error: outErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      content: finalReply,
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
