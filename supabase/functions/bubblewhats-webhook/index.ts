// Webhook BubbleWhats — recebe mensagens, aciona a IA Mônica e responde
// via BubbleWhats (texto, imagens quando cliente pede foto, áudio quando cabe).
import {
  supabase,
  loadAISettings,
  getOrCreateConversation,
  saveInboundMedia,
  transcribeAudio,
  buildContext,
  callAI,
  asksForPhoto,
  findPhotoMatches,
  synthesizeVoice,
} from "../_shared/monica-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;
const BW_BASE = `https://${DEVICE_ID}.bubblewhats.com`;
let groupWebhookConfigEnsured = false;

// Timeout defensivo — nunca deixa o worker travado esperando uma promise pendurada.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${label} after ${ms}ms`)), ms),
    ),
  ]);
}

function classifyKind(mime?: string): "image" | "audio" | "video" | "document" | null {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanJid(value: unknown): string {
  return String(value ?? "").trim();
}

async function bwPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(`${BW_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: BW_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) console.error(`BubbleWhats ${path} ${res.status}: ${text.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, text };
}

async function ensureGroupWebhookConfig() {
  if (groupWebhookConfigEnsured) return;
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bubblewhats-webhook`;
  const res = await bwPost("/config", {
    receiveMessagesWebhook: webhookUrl,
    receiveMessagesFromGroups: true,
  });
  if (res.ok) {
    groupWebhookConfigEnsured = true;
    console.log("BubbleWhats group webhook enabled");
  }
}

async function sendText(to: string, message: string) {
  return bwPost("/send-message", { jid: to, message });
}

async function sendImage(to: string, imageUrl: string, caption: string) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    console.error("sendImage: URL inválida:", imageUrl);
    return { ok: false, status: 0, text: "invalid url" };
  }
  // BubbleWhats /send-image aceita multipart com o arquivo em "image".
  // Deno fetch+FormData estava enviando chunked; a nginx do BubbleWhats
  // rejeita (500 ENOENT). Montamos o body multipart manualmente com
  // Content-Length fixo para funcionar igual ao `curl -F`.
  let bytes: Uint8Array;
  let mime = "image/jpeg";
  try {
    const r = await fetch(imageUrl);
    if (!r.ok) {
      console.error("sendImage: falha ao baixar imagem:", r.status);
      return { ok: false, status: r.status, text: "download failed" };
    }
    bytes = new Uint8Array(await r.arrayBuffer());
    mime = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  } catch (e) {
    console.error("sendImage: erro download:", e);
    return { ok: false, status: 0, text: "download error" };
  }

  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const boundary = "----BWBoundary" + Math.random().toString(16).slice(2);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const push = (s: string) => parts.push(enc.encode(s));

  push(`--${boundary}\r\nContent-Disposition: form-data; name="jid"\r\n\r\n${to}\r\n`);
  if (caption && caption.trim()) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}\r\n`);
  }
  push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`);
  parts.push(bytes);
  push(`\r\n--${boundary}--\r\n`);

  const totalLen = parts.reduce((n, p) => n + p.byteLength, 0);
  const body = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { body.set(p, off); off += p.byteLength; }

  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${BW_BASE}/send-image`, {
      method: "POST",
      headers: {
        Authorization: BW_TOKEN,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.byteLength),
      },
      body,
    });
    const text = await res.text();
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        if (j?.status === false) {
          console.error(`BubbleWhats /send-image ok=true but status=false: ${text.slice(0, 300)}`);
          return { ok: false, status: res.status, text };
        }
      } catch { /* not JSON, treat as ok */ }
      return { ok: true, status: res.status, text };
    }
    console.error(`BubbleWhats /send-image ${res.status}: ${text.slice(0, 300)}`);
    if (res.status !== 502 && res.status !== 503 && res.status !== 504) {
      return { ok: false, status: res.status, text };
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return { ok: false, status: 502, text: "bubblewhats unavailable" };
}

// Envia áudio (voice note). Faz upload no bucket para gerar URL pública temporária.
async function sendVoiceNote(to: string, bytes: Uint8Array, mime: string): Promise<boolean> {
  try {
    const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "ogg";
    const path = `outbound/${to}/${Date.now()}-voice.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) { console.error("voice upload err:", upErr); return false; }
    const { data: signed } = await supabase.storage
      .from("whatsapp-media")
      .createSignedUrl(path, 60 * 60 * 24);
    if (!signed?.signedUrl) return false;
    const r = await bwPost("/send-voice-note", { jid: to, audiourl: signed.signedUrl });
    return r.ok;
  } catch (e) {
    console.error("sendVoiceNote error:", e);
    return false;
  }
}

// Registra mensagem outbound de imagem/áudio no painel
async function logOutboundMedia(convId: string, to: string, bytes: Uint8Array, mime: string, kind: "image" | "audio", caption: string) {
  try {
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const path = `outbound/${to}/${Date.now()}-log.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return;
    await supabase.from("whatsapp_messages").insert({
      conversation_id: convId,
      direction: "outbound",
      content: caption || (kind === "image" ? "[📷 Imagem]" : "[🎤 Áudio]"),
      media_path: path,
      media_type: kind,
      media_mime: mime,
    });
  } catch (e) {
    console.error("logOutboundMedia err:", e);
  }
}

// ================= ANÁLISE DE COMPROVANTE =================
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
  }
  return btoa(bin);
}

async function analyzeAndSavePaymentProof(opts: {
  bytes: Uint8Array; mime: string; mediaPath: string;
  conversationId: string; customerId: string | null;
  whatsappMessageId: string | null; fileSize: number;
}): Promise<{ is_payment_proof: boolean; amount: number | null; summary: string | null } | null> {
  if (!LOVABLE_API_KEY) { console.warn("LOVABLE_API_KEY ausente — pulando análise"); return null; }
  const b64 = toBase64(opts.bytes);
  const dataUrl = `data:${opts.mime};base64,${b64}`;
  const isPdf = opts.mime.toLowerCase().includes("pdf");

  const userContent: any[] = [
    {
      type: "text",
      text: `Analise este arquivo enviado por uma cliente no WhatsApp e diga se é um comprovante de pagamento (PIX, transferência, boleto). Responda APENAS com um JSON válido no formato:
{"is_payment_proof": boolean, "amount": number|null, "payer_name": string|null, "bank": string|null, "transaction_id": string|null, "summary": string}
- amount em reais (número, sem R$).
- summary curto em português (1 frase).
- Se não for comprovante, is_payment_proof=false e explique brevemente no summary.`
    },
  ];
  if (isPdf) {
    userContent.push({ type: "file", file: { filename: "comprovante.pdf", file_data: dataUrl } });
  } else {
    userContent.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Você é uma assistente que analisa comprovantes de pagamento brasileiros (PIX, TED, boleto). Sempre responda em JSON puro, sem markdown." },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) { console.error("AI proof analysis error:", res.status, (await res.text()).slice(0, 300)); return null; }
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { console.warn("AI proof raw not JSON:", raw.slice(0, 200)); return null; }

  // Só salvamos na tabela payment_proofs quando a IA identifica como comprovante válido.
  // Fotos aleatórias, memes, prints etc. são ignorados para não poluir a lista.
  if (!parsed.is_payment_proof) {
    console.log("Ignorado (não é comprovante):", (parsed.summary ?? "").slice(0, 120));
  } else {
    const { error } = await supabase.from("payment_proofs").insert({
      storage_path: opts.mediaPath,
      bucket: "whatsapp-media",
      original_filename: opts.mediaPath.split("/").pop() ?? null,
      mime_type: opts.mime,
      file_size: opts.fileSize,
      source: "monica",
      customer_id: opts.customerId,
      whatsapp_message_id: opts.whatsappMessageId,
      ai_is_payment_proof: true,
      ai_amount: parsed.amount ?? null,
      ai_payer_name: parsed.payer_name ?? null,
      ai_bank: parsed.bank ?? null,
      ai_transaction_id: parsed.transaction_id ?? null,
      ai_summary: parsed.summary ?? null,
      description: parsed.summary ?? null,
    });
    if (error) console.error("payment_proofs insert err:", error);
    else console.log("Comprovante salvo:", parsed.amount);
  }

  return {
    is_payment_proof: !!parsed.is_payment_proof,
    amount: parsed.amount ?? null,
    summary: parsed.summary ?? null,
  };
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    console.log("bubblewhats-webhook payload:", JSON.stringify(payload).slice(0, 2000));
    await ensureGroupWebhookConfig();

    const messageKey = payload.messageContext?.key ?? {};
    const remoteJid = cleanJid(messageKey.remoteJid);
    const remoteJidAlt = cleanJid(messageKey.remoteJidAlt);
    const participant = cleanJid(messageKey.participant);
    const fromGroup = cleanJid(payload.fromGroup);
    const isGroup = Boolean(payload.isGroup) || fromGroup.includes("@g.us") || remoteJid.includes("@g.us");
    const senderNumber = onlyDigits(payload.fromNumber) || onlyDigits(participant) || onlyDigits(remoteJidAlt);
    const conversationKey = isGroup
      ? ((remoteJid.includes("@g.us") ? remoteJid : "") || fromGroup || `grupo-${senderNumber || payload.id || Date.now()}`)
      : senderNumber;
    if (!conversationKey) return new Response("ok", { headers: corsHeaders });

    // Nome do contato (salvo na agenda do celular conectado) e nome do grupo
    const senderAlias = cleanJid(payload.fromAlias) || cleanJid(payload.pushName) || cleanJid(payload.messageContext?.pushName);
    const groupName =
      cleanJid(payload.groupName) ||
      cleanJid(payload.groupSubject) ||
      cleanJid(payload.chatName) ||
      (fromGroup && !fromGroup.includes("@g.us") ? fromGroup : "");
    const displayName = isGroup
      ? (groupName || `Grupo ${senderAlias || senderNumber || ""}`.trim())
      : (senderAlias || senderNumber);

    let text: string = (payload.body ?? "").toString();
    const caption: string = (payload.caption ?? "").toString();
    if (!text && caption) text = caption;

    console.log("[chk] parsed", { conversationKey, isGroup, hasText: !!text, senderNumber });

    // ---- FAST-PATH: cliente pede FICHA/EXTRATO/PARCELAS ----
    // Executa ANTES de qualquer análise pesada (mídia, comprovante, IA) e usa
    // timeouts defensivos para nunca travar o worker.
    const fichaRegex = /\b(fich[ao]|extrato|minhas?\s+parcelas?|quais?\s+parcelas?|carn[êe])\b/i;
    if (text && !isGroup && senderNumber && fichaRegex.test(text)) {
      console.log("[chk] ficha fast-path start");
      try {
        const digits = senderNumber.replace(/\D/g, "");
        const variants = new Set<string>([senderNumber, digits]);
        if (digits.startsWith("55")) variants.add(digits.slice(2));
        else if (digits.length >= 10) variants.add("55" + digits);
        const { data: custs } = await withTimeout(
          supabase.from("customers").select("id, name").in("phone", Array.from(variants).filter(Boolean)),
          5000, "ficha:customers",
        );
        const custIds = (custs ?? []).map((c: any) => c.id);
        let fichaReply = "";
        if (custIds.length === 0) {
          fichaReply = "Não localizei seu cadastro aqui 💕 Me diga seu nome completo por favor?";
        } else {
          const { data: recs } = await withTimeout(
            supabase
              .from("accounts_receivable")
              .select("description, amount, due_date, status, receivable_payments(amount_paid)")
              .in("customer_id", custIds)
              .in("status", ["pendente", "vencido"])
              .order("due_date", { ascending: true }),
            7000, "ficha:receivables",
          );
          if (!recs || recs.length === 0) {
            fichaReply = `Boa notícia, ${custs![0].name.split(" ")[0]}! Você não tem nenhuma parcela em aberto 💕 Deus abençoe 🙏`;
          } else {
            const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const fmtDate = (iso: string) => {
              const [y, m, d] = String(iso).slice(0, 10).split("-");
              return `${d}/${m}/${y}`;
            };
            let total = 0;
            const lines = recs.map((r: any) => {
              const paid = (r.receivable_payments ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid || 0), 0);
              const open = Math.max(0, Number(r.amount || 0) - paid);
              total += open;
              const flag = r.status === "vencido" ? " ⚠️ vencida" : "";
              const desc = r.description ? ` — ${r.description}` : "";
              return `• ${fmtDate(r.due_date)}: ${fmtBRL(open)}${desc}${flag}`;
            }).join("\n");
            fichaReply =
              `Segue sua ficha, ${custs![0].name.split(" ")[0]} 💕\n\n` +
              `${lines}\n\n` +
              `Total em aberto: ${fmtBRL(total)}\n\n` +
              `Qualquer dúvida é só me chamar! 🙏`;
          }
        }
        console.log("[chk] ficha sending reply");
        await withTimeout(sendText(conversationKey, fichaReply), 10000, "ficha:sendText");
        // Log de conversa (best-effort) — nunca bloqueia a resposta
        try {
          const convFast = await withTimeout(
            getOrCreateConversation(conversationKey, displayName || null),
            5000, "ficha:getOrCreateConversation",
          );
          if (convFast) {
            await supabase.from("whatsapp_messages").insert([
              { conversation_id: convFast.id, direction: "inbound", content: text },
              { conversation_id: convFast.id, direction: "outbound", content: fichaReply },
            ]);
            await supabase.rpc("bump_conversation_unread", { conv_id: convFast.id });
          }
        } catch (e) { console.error("[ficha] log conv err:", e); }
        console.log("[chk] ficha fast-path done");
        return new Response(JSON.stringify({ ok: true, ficha: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("ficha fast-path err:", e);
        // Cai no fluxo normal se algo falhou
      }
    }


    // ---- REAÇÃO A STATUS (curtida em foto que postamos) ----
    // BubbleWhats entrega em messageContext.message.reactionMessage
    try {
      const reactionMsg = payload.messageContext?.message?.reactionMessage;
      if (reactionMsg && !isGroup) {
        const reactedKey = reactionMsg.key ?? {};
        const reactedRemote = String(reactedKey.remoteJid ?? "");
        const reactedFromMe = Boolean(reactedKey.fromMe);
        const reactedId = String(reactedKey.id ?? "");
        const emoji = String(reactionMsg.text ?? "").trim();
        const isStatusReaction = reactedRemote.includes("status@broadcast") || reactedFromMe;
        const POSITIVE_EMOJIS = ["👍","❤️","♥️","❤","🧡","💛","💚","💙","💜","🤎","🖤","🤍","💖","💗","💓","💕","💞","💘","💝","😍","🥰","😘","🤩","😻","🔥","👏","🙌","✨","🌹","💐","😊","🙏"];
        const isPositive = !emoji || POSITIVE_EMOJIS.some(e => emoji.includes(e)) || /like|love|heart/i.test(emoji);

        if (isStatusReaction && isPositive && senderNumber) {
          const targetKey = reactedId || `status-${Date.now()}`;
          // Dedupe: já enviamos para esse cliente + esse item do status?
          const { data: already } = await supabase
            .from("status_reaction_sent")
            .select("id")
            .eq("phone", senderNumber)
            .eq("target_key", targetKey)
            .maybeSingle();
          if (!already) {
            const conv = await getOrCreateConversation(senderNumber, senderAlias || null);
            const firstName = (senderAlias || "").split(" ")[0]?.trim();
            const greet = firstName ? `Bacana, ${firstName}!` : "Bacana!";

            // Verifica estoque dos itens atualmente no status (não expirados)
            let outOfStock = false;
            try {
              const { data: activePosts } = await supabase
                .from("status_posts")
                .select("product_id, variant_id")
                .gt("expires_at", new Date().toISOString());
              if (activePosts && activePosts.length > 0) {
                const variantIds = activePosts.map((p: any) => p.variant_id).filter(Boolean);
                let totalStock = 0;
                if (variantIds.length > 0) {
                  const { data: vars } = await supabase
                    .from("product_variants").select("quantity").in("id", variantIds);
                  totalStock += (vars ?? []).reduce((s: number, v: any) => s + (v.quantity ?? 0), 0);
                }
                const productsWithoutVariant = activePosts
                  .filter((p: any) => !p.variant_id && p.product_id)
                  .map((p: any) => p.product_id);
                if (productsWithoutVariant.length > 0) {
                  const { data: vars2 } = await supabase
                    .from("product_variants").select("quantity").in("product_id", productsWithoutVariant);
                  totalStock += (vars2 ?? []).reduce((s: number, v: any) => s + (v.quantity ?? 0), 0);
                }
                outOfStock = totalStock <= 0;
              }
            } catch (e) { console.error("stock check err:", e); }

            const msg = outOfStock
              ? `${greet}\n\nQue pena, essa peça já esgotou 😥 Quer que eu te avise assim que voltar ou te mostre algo parecido?`
              : `${greet}\n\nMe fala o tamanho e a cor que você gostaria pra eu separar aqui.`;
            const send = await sendText(senderNumber, msg);
            if (send.ok && conv) {
              await supabase.from("whatsapp_messages").insert({
                conversation_id: conv.id,
                direction: "outbound",
                content: msg,
              });
              await supabase.rpc("bump_conversation_unread", { conv_id: conv.id });
            }
            await supabase.from("status_reaction_sent").insert({ phone: senderNumber, target_key: targetKey });
          }
          return new Response(JSON.stringify({ ok: true, statusReaction: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (e) { console.error("reaction parse err:", e); }



    // ---- CITAÇÃO / RESPOSTA A STATUS ----
    // Detecta se o cliente respondeu a um status do WhatsApp postado por NÓS.
    // Estrutura: messageContext.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage
    // Status = participant do contextInfo aponta para o NOSSO número (toNumber).
    let quotedThumbnailPath: string | null = null;
    let quotedThumbnailBytes: Uint8Array | null = null;
    let quotedIsStatus = false;
    let quotedCaption: string | null = null;
    try {
      const ctxInfo = payload.messageContext?.message?.extendedTextMessage?.contextInfo
        ?? payload.messageContext?.message?.imageMessage?.contextInfo
        ?? payload.messageContext?.message?.conversation?.contextInfo;
      const quoted = ctxInfo?.quotedMessage;
      const quotedImg = quoted?.imageMessage;
      const quotedParticipant = onlyDigits(ctxInfo?.participant);
      const ownNumber = onlyDigits(payload.toNumber);
      if (quotedImg) {
        quotedIsStatus =
          (ctxInfo?.remoteJid?.toString().includes("status@broadcast") ?? false) ||
          (!!quotedParticipant && !!ownNumber && quotedParticipant === ownNumber);
        quotedCaption = (quotedImg.caption ?? "").toString() || null;
        // jpegThumbnail é base64 (sem prefixo data:)
        const thumbB64: string | undefined = quotedImg.jpegThumbnail;
        if (thumbB64 && !isGroup) {
          try {
            const bin = atob(thumbB64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            quotedThumbnailBytes = bytes;
            quotedThumbnailPath = await saveInboundMedia(
              bytes,
              "image/jpeg",
              `quoted/${conversationKey.replace(/[^\w.-]/g, "_")}`,
            );
          } catch (e) { console.error("quoted thumb save err:", e); }
        }
      }
    } catch (e) { console.error("quoted parse err:", e); }

    // ---- MÍDIA RECEBIDA ----
    const mediaUrl: string | undefined = payload.url || undefined;
    const mimetype: string | undefined = payload.mimetype || undefined;
    let mediaPath: string | null = null;
    let mediaKind: string | null = null;
    let mediaBytes: Uint8Array | null = null;

    if (mediaUrl && mimetype) {
      try {
        const res = await fetch(mediaUrl);
        if (res.ok) {
          mediaBytes = new Uint8Array(await res.arrayBuffer());
          mediaKind = classifyKind(mimetype);
          mediaPath = await saveInboundMedia(mediaBytes, mimetype, conversationKey.replace(/[^\w.-]/g, "_"));

          // Áudio: transcreve para alimentar a IA
          if (mediaKind === "audio" && !text) {
            // base64 chunked
            let bin = "";
            const CHUNK = 0x8000;
            for (let i = 0; i < mediaBytes.length; i += CHUNK) {
              bin += String.fromCharCode.apply(null, mediaBytes.subarray(i, i + CHUNK) as any);
            }
            const b64 = btoa(bin);
            const t = await transcribeAudio(b64, mimetype);
            if (t) { text = t; console.log("áudio transcrito:", t.slice(0, 120)); }
          }
        }
      } catch (e) {
        console.error("media download err:", e);
      }
    }

    // Cria/pega conversa (armazena/atualiza nome do grupo ou do contato)
    console.log("[chk] before getOrCreateConversation");
    let conv: Awaited<ReturnType<typeof getOrCreateConversation>> | null = null;
    try {
      conv = await withTimeout(
        getOrCreateConversation(conversationKey, displayName || null),
        8000, "getOrCreateConversation",
      );
    } catch (e) {
      console.error("[chk] getOrCreateConversation timeout/err:", e);
      return new Response(JSON.stringify({ ok: false, error: "conv timeout" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("[chk] conv", conv?.id);
    if (!conv) return new Response("ok", { headers: corsHeaders });

    // Grava inbound
    const isPdf = (mimetype ?? "").toLowerCase().includes("pdf");
    const labelByKind: Record<string, string> = {
      image: "[📷 Imagem]", audio: "[🎤 Áudio]",
      document: isPdf ? "[📄 PDF]" : "[📎 Documento]", video: "[🎥 Vídeo]",
    };
    const senderLabel = senderAlias || senderNumber || "Participante";
    const inboundContentBase = text?.trim() || (mediaKind ? labelByKind[mediaKind] : "");
    const inboundContent = isGroup && inboundContentBase ? `${senderLabel}: ${inboundContentBase}` : inboundContentBase;
    const { data: insertedMsg } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: inboundContent,
      media_path: mediaPath,
      media_type: mediaKind,
      media_mime: mimetype ?? null,
      quoted_thumbnail_path: quotedThumbnailPath,
      quoted_is_status: quotedIsStatus,
      quoted_caption: quotedCaption,
    }).select("id").single();
    await supabase.from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    // ---- ANÁLISE DE COMPROVANTE (imagem/PDF) via Lovable AI ----
    // Executa SÍNCRONO para poder curto-circuitar a resposta caso seja comprovante.
    let proofResult: { is_payment_proof: boolean; amount: number | null; summary: string | null } | null = null;
    if (mediaBytes && mediaPath && (mediaKind === "image" || mediaKind === "document") && !isGroup) {
      try {
        proofResult = await analyzeAndSavePaymentProof({
          bytes: mediaBytes,
          mime: mimetype!,
          mediaPath,
          conversationId: conv.id,
          customerId: (conv as any).customer_id ?? null,
          whatsappMessageId: insertedMsg?.id ?? null,
          fileSize: mediaBytes.length,
        });
      } catch (e) {
        console.error("analyzeAndSavePaymentProof err:", e);
      }
    }

    // Se for comprovante de pagamento, responde SEMPRE com "Deus abençoe 🙏" e não chama a IA.
    if (proofResult?.is_payment_proof) {
      const fixedReply = "Recebi seu comprovante, muito obrigada! Deus abençoe 🙏";
      await sendText(conversationKey, fixedReply);
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        direction: "outbound",
        content: fixedReply,
      });
      await supabase.rpc("bump_conversation_unread", { conv_id: conv.id });
      return new Response(JSON.stringify({ ok: true, paymentProof: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Se não temos texto (foto sem caption) ou é grupo, não chama a IA
    if (!text || isGroup) return new Response(JSON.stringify({ ok: true, skippedAI: isGroup ? "group" : "no-text" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ---- IA MÔNICA ----
    const ai = await loadAISettings();

    // Pausa global da IA
    if (ai?.ai_paused) {
      console.log("Monica pausada globalmente — pulando resposta");
      return new Response(JSON.stringify({ ok: true, skippedAI: "paused" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Whitelist de contatos que a Mônica nunca deve responder
    const { data: blocked } = await supabase
      .from("ai_blocked_contacts")
      .select("phone")
      .eq("phone", senderNumber)
      .maybeSingle();
    if (blocked) {
      console.log("Contato na whitelist — Mônica não responde:", senderNumber);
      return new Response(JSON.stringify({ ok: true, skippedAI: "blocked" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // (atalho de FICHA já foi tratado no fast-path lá em cima)



    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content, media_type, media_filename, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);
    const isFirstMessage = (history?.length ?? 0) <= 1;

    const contactAliasForCtx = isGroup ? null : (senderAlias || null);
    const ctx = await buildContext(conversationKey, text, history ?? [], contactAliasForCtx);
    // Se a cliente respondeu ao nosso status, injeta a miniatura para a IA "ver" a peça.
    const quotedImageForAI = quotedIsStatus && quotedThumbnailBytes
      ? { bytes: quotedThumbnailBytes, mime: "image/jpeg" }
      : null;
    const reply = await callAI(
      ai?.system_prompt ?? "",
      history ?? [],
      text,
      ctx,
      isFirstMessage,
      { key: ai?.pix_key, type: ai?.pix_key_type, recipient: ai?.pix_recipient_name },
      quotedImageForAI,
    );

    // ---- FOTOS quando a cliente pediu ----
    let photoFailed = false;
    let photosSent = 0;
    if (asksForPhoto(text)) {
      const photos = await findPhotoMatches(text, ctx.supplierMentioned, history ?? []);
      for (const ph of photos) {
        const r = await sendImage(conversationKey, ph.url, ph.caption);
        if (r.ok) {
          photosSent++;
          try {
            const ir = await fetch(ph.url);
            if (ir.ok) {
              const bs = new Uint8Array(await ir.arrayBuffer());
              const mm = (ir.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
              await logOutboundMedia(conv.id, conversationKey, bs, mm, "image", ph.caption);
            }
          } catch { /* noop */ }
        }
      }
      if (photos.length > 0 && photosSent === 0) photoFailed = true;
    }

    // Se a IA afirmou ter enviado foto(s) mas nenhuma foi realmente enviada,
    // substitui a resposta pelo encaminhamento humano (evita "mandei aqui" fantasma).
    const claimsPhotoSent =
      /\b(mandei|enviei|segue|segueei|olha|olhe|veja|t[ôo] mandando|estou mandando|acabei de (mandar|enviar)|vou (te )?(mandar|enviar))\b[^.\n!?]{0,80}\b(a\s+|as\s+|umas?\s+)?(foto|fotos|imagem|imagens|figura|figuras)\b/i.test(reply)
      || /\b(foto|fotos|imagem|imagens)\b[^.\n!?]{0,30}\b(a[ií]|ali|acima|abaixo|em anexo|anexo)\b/i.test(reply)
      || /\b(mandei|enviei|segue|olha|olhe|veja)\b\s+(a[ií]|aqui|agora|pra\s+voc[êe]|pra\s+ti)\b/i.test(reply);
    const phantomPhoto = claimsPhotoSent && photosSent === 0;

    const handoffReply = "Olá! Parece que houve um pequeno desencontro com a foto do produto, ou ela não está disponível em nosso sistema neste momento. Peço desculpas por qualquer inconveniente! 🙏\n\nPara garantir que você tenha todas as informações e um atendimento completo, já estou passando seu contato para o nosso atendimento humano, que continuará a conversa a partir daqui com acesso a todo o histórico e poderá te ajudar com detalhes, descrições ou qualquer outra dúvida sobre o produto.\n\nAguarde um instante, a Monica já está chegando!";

    const finalReply = (phantomPhoto || photoFailed)
      ? handoffReply
      : reply;

    if (phantomPhoto) {
      console.warn("[MONICA] phantom photo claim — handoff. original:", reply.slice(0, 200));
    }
    if (photoFailed) {
      console.warn("[MONICA] photo send failed — handoff.");
    }


    // ---- ÁUDIO (quando cliente mandou áudio ou pediu) ----
    const clientSentAudio = mediaKind === "audio";
    const low = text.toLowerCase();
    const clientAskedForAudio =
      /\b(a[uú]dio|voz|falando|falada|por v[oó]z)\b/.test(low) ||
      /n[ãa]o\s+(sei|consigo|posso)\s+ler/.test(low) ||
      /(me\s+)?(manda|envia|responde|fala)\s+(em|por|de)?\s*(a[uú]dio|voz)/.test(low);
    let audioSent = false;
    if (clientSentAudio || clientAskedForAudio) {
      const voice = await synthesizeVoice(finalReply);
      if (voice) {
        audioSent = await sendVoiceNote(conversationKey, voice.bytes, voice.mime);
        if (audioSent) await logOutboundMedia(conv.id, conversationKey, voice.bytes, voice.mime, "audio", finalReply);
      }
    }

    if (!audioSent) {
      await sendText(conversationKey, finalReply);
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        direction: "outbound",
        content: finalReply,
      });
    }

    await supabase.rpc("bump_conversation_unread", { conv_id: conv.id });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bubblewhats-webhook error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "erro" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
