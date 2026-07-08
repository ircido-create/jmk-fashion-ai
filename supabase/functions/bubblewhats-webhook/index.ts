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

async function sendText(to: string, message: string) {
  return bwPost("/send-message", { jid: to, message });
}

async function sendImage(to: string, imageUrl: string, caption: string) {
  return bwPost("/send-image", { jid: to, imageUrl, caption });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    console.log("bubblewhats-webhook payload:", JSON.stringify(payload).slice(0, 2000));

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
    const conv = await getOrCreateConversation(conversationKey, displayName || null);
    if (!conv) return new Response("ok", { headers: corsHeaders });

    // Grava inbound
    const labelByKind: Record<string, string> = {
      image: "[📷 Imagem]", audio: "[🎤 Áudio]",
      document: "[📎 Documento]", video: "[🎥 Vídeo]",
    };
    const senderLabel = senderAlias || senderNumber || "Participante";
    const inboundContentBase = text?.trim() || (mediaKind ? labelByKind[mediaKind] : "");
    const inboundContent = isGroup && inboundContentBase ? `${senderLabel}: ${inboundContentBase}` : inboundContentBase;
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: inboundContent,
      media_path: mediaPath,
      media_type: mediaKind,
      media_mime: mimetype ?? null,
    });
    await supabase.from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    // Se não temos texto (foto sem caption) ou é grupo, não chama a IA
    if (!text || isGroup) return new Response(JSON.stringify({ ok: true, skippedAI: isGroup ? "group" : "no-text" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ---- IA MÔNICA ----
    const ai = await loadAISettings();
    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content, media_type, media_filename, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);
    const isFirstMessage = (history?.length ?? 0) <= 1;

    const ctx = await buildContext(conversationKey, text, history ?? []);
    const reply = await callAI(
      ai?.system_prompt ?? "",
      history ?? [],
      text,
      ctx,
      isFirstMessage,
      { key: ai?.pix_key, type: ai?.pix_key_type, recipient: ai?.pix_recipient_name }
    );

    // ---- FOTOS quando a cliente pediu ----
    let photoFailed = false;
    if (asksForPhoto(text)) {
      const photos = await findPhotoMatches(text, ctx.supplierMentioned, history ?? []);
      let sent = 0;
      for (const ph of photos) {
        const r = await sendImage(conversationKey, ph.url, ph.caption);
        if (r.ok) {
          sent++;
          // baixa a imagem e loga
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
      if (photos.length > 0 && sent === 0) photoFailed = true;
    }

    const finalReply = photoFailed
      ? `Ah, desculpa! Tentei te mandar as fotos mas não consegui enviar agora 😅 Mas posso te descrever:\n\n${reply}`
      : reply;

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

    await supabase.from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

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
