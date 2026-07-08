// Webhook do BubbleWhats para RECEBIMENTO de mensagens.
// Configurado no painel do dispositivo em receiveMessagesWebhook.
// Docs: https://app.bubblewhats.com/documentation
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extFromMime(mime: string): string {
  const m: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
    "audio/aac": "aac", "audio/wav": "wav", "audio/webm": "webm",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/zip": "zip",
  };
  return m[mime] ?? "bin";
}

function classifyKind(mime?: string): "image" | "audio" | "video" | "document" | null {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const payload = await req.json();
    console.log("bubblewhats-webhook payload:", JSON.stringify(payload).slice(0, 500));

    const fromNumber: string = String(payload.fromNumber ?? "").replace(/\D/g, "");
    const isGroup = Boolean(payload.isGroup);
    const fromGroup: string | undefined = payload.fromGroup;
    const conversationKey = isGroup && fromGroup ? fromGroup : fromNumber;
    if (!conversationKey) {
      return new Response(JSON.stringify({ ignored: "sem remetente" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: string = payload.body ?? "";
    const caption: string = payload.caption ?? "";
    const url: string | undefined = payload.url;
    const mimetype: string | undefined = payload.mimetype;
    const messageType: string = payload.messageType ?? "text";
    const externalId: string | undefined = payload.id;
    const timestamp: number = Number(payload.timestamp) || Math.floor(Date.now() / 1000);

    // ---- Encontra/cria conversa ----
    let { data: conv } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("customer_phone", conversationKey)
      .maybeSingle();

    if (!conv) {
      const { data: customer } = await admin
        .from("customers").select("id").eq("phone", conversationKey).maybeSingle();
      const { data: created, error: cErr } = await admin
        .from("whatsapp_conversations")
        .insert({
          customer_phone: conversationKey,
          customer_id: customer?.id ?? null,
        })
        .select().single();
      if (cErr) throw cErr;
      conv = created;
    }

    // ---- Baixa e persiste mídia (BubbleWhats expira em 24h) ----
    let mediaPath: string | null = null;
    let mediaKind: string | null = null;
    if (url && mimetype) {
      try {
        const kind = classifyKind(mimetype);
        mediaKind = kind;
        const ext = extFromMime(mimetype);
        const filename = `${externalId ?? Date.now()}.${ext}`;
        const storagePath = `inbound/${conversationKey}/${filename}`;
        const mediaRes = await fetch(url);
        if (mediaRes.ok) {
          const buf = new Uint8Array(await mediaRes.arrayBuffer());
          const { error: upErr } = await admin.storage
            .from("whatsapp-media")
            .upload(storagePath, buf, { contentType: mimetype, upsert: false });
          if (!upErr) mediaPath = storagePath;
          else console.error("storage upload error:", upErr);
        } else {
          console.error("media fetch failed:", mediaRes.status);
        }
      } catch (e) {
        console.error("media download error:", e);
      }
    }

    // ---- Grava mensagem ----
    const contentText =
      body?.trim() ||
      caption?.trim() ||
      (mediaKind === "image" ? "[📷 Imagem]" :
       mediaKind === "audio" ? "[🎤 Áudio]" :
       mediaKind === "video" ? "[🎥 Vídeo]" :
       mediaKind === "document" ? "[📎 Documento]" :
       `[${messageType}]`);

    await admin.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: contentText,
      media_path: mediaPath,
      media_type: mediaKind,
      media_mime: mimetype ?? null,
      created_at: new Date(timestamp * 1000).toISOString(),
    });

    await admin.from("whatsapp_conversations")
      .update({ last_message_at: new Date(timestamp * 1000).toISOString() })
      .eq("id", conv.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bubblewhats-webhook error:", e);
    // Retorne 200 para o BubbleWhats não reenviar em loop caso a mensagem seja malformada
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "erro" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
