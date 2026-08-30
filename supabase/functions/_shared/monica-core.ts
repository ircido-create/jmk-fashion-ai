// Núcleo compartilhado da IA "Mônica" — RAG, contexto, LLM, TTS, mídia.
// Consumido pelos webhooks (BubbleWhats hoje; Meta legado).
// Não tem Deno.serve nem faz I/O ao carregar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const supabase = createClient(
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

// Reduz diminutivos/aumentativos pt-BR para a raiz, p/ casar "blusinha" com "BLUSA".
// Só aplica se a raiz resultante tiver >= 4 letras, pra não virar coisa nada-a-ver.
function stemPtBr(word: string): string {
  const suffixes = ["zinhas", "zinhos", "zinha", "zinho", "inhas", "inhos", "inha", "inho", "ona", "onas", "ao", "oes"];
  for (const suf of suffixes) {
    if (word.endsWith(suf) && word.length - suf.length >= 4) {
      return word.slice(0, -suf.length);
    }
  }
  return word;
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stemPtBr)
    .slice(0, 8);
}

export async function loadAISettings() {
  const { data } = await supabase.from("ai_settings").select("*").maybeSingle();
  return data;
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
export async function saveInboundMedia(
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
export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
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

// === ElevenLabs TTS — voz dinâmica (clonada ou padrão) ===
// Lê voice_id ativo da tabela voice_clones; se nenhuma estiver ativa, usa Matilda como fallback.
const ELEVEN_FALLBACK_VOICE_ID = "XrExE9yKIg1WjnnlVkGX"; // Matilda (nativa)
const ELEVEN_MODEL_PRIMARY = "eleven_multilingual_v2";
const ELEVEN_MODEL_FALLBACK = "eleven_turbo_v2_5";

let _cachedVoiceId: string = ELEVEN_FALLBACK_VOICE_ID;
let _cachedVoiceAt = 0;
async function getActiveVoiceId(): Promise<string> {
  const now = Date.now();
  if (_cachedVoiceAt && now - _cachedVoiceAt < 60_000) return _cachedVoiceId;
  try {
    const { data } = await supabase
      .from("voice_clones")
      .select("voice_id")
      .eq("is_active", true)
      .maybeSingle();
    _cachedVoiceId = data?.voice_id || ELEVEN_FALLBACK_VOICE_ID;
  } catch {
    _cachedVoiceId = ELEVEN_FALLBACK_VOICE_ID;
  }
  _cachedVoiceAt = now;
  return _cachedVoiceId;
}

// Pré-processa texto para soar natural quando falado em voz alta:
// remove emojis, markdown, tags internas; expande URLs e datas DD/MM.
function preprocessForTts(input: string): string {
  let t = input;
  // 1) Tags internas tipo [LEAD_QUALIFIED], [CONTEXTO:...]
  t = t.replace(/\[[A-Z_]+(?::[^\]]*)?\]/g, " ");
  // 2) Markdown: **negrito**, *itálico*, _underline_
  t = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/(?<!\w)[*_](.+?)[*_](?!\w)/g, "$1");
  // 3) URLs → fala natural (https://loja.com.br → "loja ponto com ponto br")
  t = t.replace(/https?:\/\/(\S+)/gi, (_m, url: string) =>
    url.replace(/\./g, " ponto ").replace(/\//g, " barra ")
  );
  t = t.replace(/\b([a-z0-9-]+)\.(com|br|net|org|io|app)\b/gi, (_m, name, tld) => `${name} ponto ${tld}`);
  // 4) Datas DD/MM ou DD/MM/YYYY → "dia DD do mês MM"
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (_m, d, m, _y) => {
    const mi = parseInt(m, 10) - 1;
    return mi >= 0 && mi < 12 ? `dia ${parseInt(d, 10)} de ${meses[mi]}` : `${d} de ${m}`;
  });
  // 5) Emojis e pictogramas (Symbols/Emoticons/Pictographs/Transport/Misc/Dingbats/Flags)
  t = t.replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u200D/gu, "");
  // 6) Reticências viram pausas naturais (ElevenLabs respeita "..." como pausa)
  t = t.replace(/\.{3,}/g, "...");
  // 7) Espaços múltiplos
  t = t.replace(/\s+/g, " ").trim();
  // 8) Adiciona micro-hesitações humanas no início (1 em cada 3 mensagens)
  //    para soar mais real — "ah", "então", "olha" — sem exagerar.
  if (t.length > 30 && Math.random() < 0.33) {
    const fillers = ["Então, ", "Olha, ", "Ah, ", "Tá, "];
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    // Só adiciona se ainda não começa com palavra de saudação/conector
    if (!/^(oi|ol[áa]|paz|bom|boa|ent[ãa]o|olha|ah|t[áa])\b/i.test(t)) {
      t = filler + t.charAt(0).toLowerCase() + t.slice(1);
    }
  }
  return t;
}

async function callEleven(text: string, modelId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return null;
  const voiceId = await getActiveVoiceId();
  // MP3 44.1kHz/128kbps — melhor qualidade que opus para voz humana realista no WhatsApp.
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        language_code: "pt",
        // Settings ajustadas para voz feminina madura ULTRA-REALISTA:
        // - stability baixa (0.35) → mais variação emocional, soa humana e não "robótica"
        // - similarity_boost alta (0.85) → mantém timbre original, evita drift
        // - style alto (0.55) → enfatiza expressividade natural, respirações
        // - speaker_boost → reforça timbre e clareza
        // - speed 0.95 → levemente mais lenta, ritmo conversacional natural
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.85,
          style: 0.55,
          use_speaker_boost: true,
          speed: 0.95,
        },
        // Normalização de números/abreviações para soar natural ao falar.
        apply_text_normalization: "on",
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`ElevenLabs TTS [${modelId}] error:`, res.status, body);
    return null;
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), mime: "audio/mpeg" };
}

// Fallback de TTS via Lovable AI (usado quando a ElevenLabs falha, ex.: quota esgotada)
async function callLovableTts(text: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: text,
        voice: "shimmer",
        response_format: "mp3",
        speed: 0.97,
        instructions:
          "Fale em português do Brasil com voz feminina adulta, natural e humana. Tom calmo, cordial e acolhedor; entonação conversacional e amigável. Pronúncia clara, ritmo natural sem pressa, com pequenas pausas naturais entre as frases. Demonstre empatia e simpatia, nunca soe robótica, apressada ou fria.",
      }),
    });
    if (!res.ok) {
      console.error("Lovable TTS error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return null;
    return { bytes: new Uint8Array(buf), mime: "audio/mpeg" };
  } catch (e) {
    console.error("Lovable TTS exception:", e);
    return null;
  }
}

export async function synthesizeVoice(text: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  // Limita a 800 chars (economia de quota + áudios curtos e naturais)
  let safeText = preprocessForTts(text);
  if (!safeText) return null;
  if (safeText.length > 800) safeText = safeText.slice(0, 797) + "...";

  // OBS: tags como [soft breath] só são interpretadas pelo modelo eleven_v3.
  // No multilingual_v2/turbo_v2_5 (que usamos), elas seriam LIDAS literalmente
  // ("soft breath..."), então não adicionamos nenhuma tag aqui.

  try {
    let result: { bytes: Uint8Array; mime: string } | null = null;
    if (Deno.env.get("ELEVENLABS_API_KEY")) {
      // Tenta primeiro o modelo primário (multilingual_v2 — melhor qualidade humana).
      // Fallback: turbo_v2_5 (mais rápido, ainda excelente).
      result = await callEleven(safeText, ELEVEN_MODEL_PRIMARY);
      if (!result) {
        console.warn(`[tts] Fallback para ${ELEVEN_MODEL_FALLBACK}`);
        result = await callEleven(safeText, ELEVEN_MODEL_FALLBACK);
      }
    }
    if (!result) {
      console.warn("[tts] ElevenLabs indisponível — usando TTS da Lovable AI");
      result = await callLovableTts(safeText);
    }
    return result;
  } catch (e) {
    console.error("synthesizeVoice error:", e);
    return null;
  }
}




// Detecta se a cliente pediu foto/imagem
export function asksForPhoto(text: string): boolean {
  const t = norm(text);
  return /(foto|fotos|imagem|imagens|figura|me manda.*foto|tem foto|tem imagem|posso ver|me mostra|manda.*foto)/.test(t);
}

// Frases genéricas de "me manda foto/de novo" — sem produto específico.
// Também considera genérico quando só sobram pronomes ("dela", "dele", "disso"...),
// porque nesse caso o produto está implícito no histórico da conversa.
function isGenericPhotoRequest(text: string): boolean {
  const t = norm(text);
  // Remove os verbos de pedir foto e pronomes/preposições, e vê o que sobra
  const stripped = t
    .replace(/(foto|fotos|imagem|imagens|figura|figuras)/g, "")
    .replace(/(me manda|me envia|me mostra|envia|manda|mostra|posso ver|tem|pode|poderia|novamente|de novo|outra vez|tambem|também)/g, "")
    .replace(/\b(dela|dele|delas|deles|disso|dessa|desse|dessas|desses|essa|esse|essas|esses|aquela|aquele|aquelas|aqueles|uma|um|umas|uns|de|do|da|dos|das|para|pra|por|com|favor|por favor)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return stripped.length < 3; // sobrou quase nada → é genérico
}

// Junta a mensagem atual com mensagens anteriores do cliente E a última resposta do bot
// para inferir o produto pedido quando o pedido de foto é genérico ("me manda uma foto dela").
function buildPhotoQueryContext(userMsg: string, history: any[]): string {
  if (!isGenericPhotoRequest(userMsg)) return userMsg;
  // Pega as últimas 4 mensagens do CLIENTE (inbound) — provável que mencionem o produto
  const inbounds = history.filter((m: any) => m.direction === "inbound").slice(-4);
  const ctxText = inbounds.map((m: any) => m.content).join(" ");
  // A última resposta do bot é CRÍTICA: costuma citar o nome exato do produto recém-mencionado
  // (ex: "A BLUSA 7196 CAROL TRICO está disponível...") — vale mais que qualquer outra fonte
  const lastBot = [...history].reverse().find((m: any) => m.direction === "outbound");
  const combined = `${lastBot?.content ?? ""} ${ctxText} ${userMsg}`.trim();
  console.log("[photo] generic request → combined query:", combined.slice(0, 200));
  return combined;
}

// Busca variações com foto que correspondam à mensagem (com fallback para o contexto da conversa)
export async function findPhotoMatches(
  userMsg: string,
  supplier: string | null,
  history: any[] = [],
): Promise<{ url: string; caption: string }[]> {
  const queryText = buildPhotoQueryContext(userMsg, history);
  const keywords = extractKeywords(queryText);
  console.log("[photo] keywords:", keywords, "supplier:", supplier);

  // 1) Busca por produtos cujo name/description/category/sku case com alguma keyword
  let q = supabase
    .from("products")
    .select("id, name, supplier, product_variants(size, color, image_url, quantity)")
    .eq("active", true)
    .limit(20);
  if (supplier) q = q.eq("supplier", supplier);
  if (keywords.length > 0) {
    q = q.or(keywords.flatMap((k) => [`name.ilike.%${k}%`, `description.ilike.%${k}%`, `category.ilike.%${k}%`, `sku.ilike.%${k}%`]).join(","));
  }
  const { data: byProduct } = await q;

  // 2) Busca também variantes cuja color/size case com keywords (ex.: "marrom", "preto", "P", "M")
  const productsById = new Map<string, any>();
  for (const p of byProduct ?? []) productsById.set((p as any).id, p);

  if (keywords.length > 0) {
    const variantOr = keywords
      .flatMap((k) => [`color.ilike.%${k}%`, `size.ilike.%${k}%`])
      .join(",");
    const { data: variantHits } = await supabase
      .from("product_variants")
      .select("product_id")
      .or(variantOr)
      .not("image_url", "is", null)
      .limit(40);
    const extraIds = Array.from(
      new Set((variantHits ?? []).map((v: any) => v.product_id).filter((id: string) => !productsById.has(id)))
    );
    if (extraIds.length > 0) {
      let q2 = supabase
        .from("products")
        .select("id, name, supplier, product_variants(size, color, image_url, quantity)")
        .eq("active", true)
        .in("id", extraIds);
      if (supplier) q2 = q2.eq("supplier", supplier);
      const { data: extraProducts } = await q2;
      for (const p of extraProducts ?? []) productsById.set((p as any).id, p);
    }
  }

  // 3) Para cada produto, ordena variantes priorizando as que casam com keywords (cor/tamanho)
  const variantMatchesKeyword = (v: any) => {
    if (keywords.length === 0) return false;
    const hay = `${v.color ?? ""} ${v.size ?? ""}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return keywords.some((k) => hay.includes(k));
  };

  const out: { url: string; caption: string }[] = [];
  for (const p of productsById.values()) {
    const variants = ((p as any).product_variants ?? []).filter((v: any) => v.image_url);
    variants.sort((a: any, b: any) => {
      const am = variantMatchesKeyword(a) ? 1 : 0;
      const bm = variantMatchesKeyword(b) ? 1 : 0;
      return bm - am;
    });
    for (const v of variants) {
      const variantLabel = [v.size, v.color].filter(Boolean).join(" / ");
      out.push({ url: v.image_url, caption: `${(p as any).name}${variantLabel ? ` — ${variantLabel}` : ""}` });
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export async function getOrCreateConversation(phone: string, displayName?: string | null) {
  // Busca a conversa mais antiga com esse telefone (pode existir mais de uma por corrida antiga)
  const { data: existingRows } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("customer_phone", phone)
    .order("created_at", { ascending: true })
    .limit(1);
  const existing = existingRows?.[0];
  if (existing) {
    if (displayName && existing.display_name !== displayName) {
      await supabase
        .from("whatsapp_conversations")
        .update({ display_name: displayName })
        .eq("id", existing.id);
      (existing as any).display_name = displayName;
    }
    return existing;
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  const { data: created, error: insertErr } = await supabase
    .from("whatsapp_conversations")
    .insert({
      customer_phone: phone,
      customer_id: customer?.id ?? null,
      display_name: displayName ?? null,
    })
    .select()
    .single();
  // Se falhou por corrida (índice único), busca a existente
  if (insertErr) {
    const { data: retry } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("customer_phone", phone)
      .order("created_at", { ascending: true })
      .limit(1);
    return retry?.[0] ?? null;
  }
  return created;
}

// Normaliza para comparação (sem acento, minúsculo, sem espaços extras)
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// === Inferência de gênero pelo primeiro nome (heurística pt-BR) ===
// Retorna "F" | "M" | "U" (desconhecido). Usado para evitar tratar
// homem como "querida" e vice-versa.
const MALE_NAMES = new Set([
  "joao","jose","pedro","paulo","lucas","luis","luiz","marcos","marco","mateus","matheus",
  "gabriel","rafael","daniel","felipe","filipe","fernando","carlos","andre","antonio","alexandre",
  "ricardo","rodrigo","roberto","bruno","thiago","tiago","leonardo","leandro","gustavo","guilherme",
  "diego","douglas","eduardo","edson","emerson","fabio","flavio","henrique","hugo","igor","ivan",
  "jorge","julio","kevin","marcelo","mario","mauricio","murilo","nathan","otavio","raul","renan",
  "renato","samuel","sergio","vinicius","vitor","victor","wagner","wesley","william","willian",
  "yuri","arthur","artur","bernardo","caio","cesar","cristiano","davi","david","enzo","erick","eric",
  "fabricio","francisco","ismael","israel","ivo","jean","jonas","jonathan","kaio","levi","luan",
  "miguel","nicolas","noah","ramon","raphael","reinaldo","rian","ryan","saulo","silas","theo",
  "valter","walter","wallace","washington","welinton","welington","wellington","adriano","alex","alan",
  "allan","amauri","aldo","aluisio","aluizio","arnaldo","benedito","benjamim","cassio","claudio",
  "cleber","clovis","danilo","dario","dener","denis","dennis","derek","dirceu","domingos","edmilson",
  "edmundo","edvaldo","elias","eliel","elizeu","elton","emanuel","ezequiel","fabiano","francinaldo",
  "geraldo","gilberto","gilmar","heitor","heric","ian","ibere","idelfonso","ildefonso","ilan",
  "joaquim","jovani","junior","kauan","kaue","laercio","lazaro","lourival","lucio","luciano",
  "manoel","manuel","mauro","mike","milton","moacir","moises","natanael","nelson","newton","odair",
  "olavo","orlando","osmar","oswaldo","peterson","plinio","reinan","robson","ronald","ronaldo",
  "ruan","rui","salomao","sandro","sebastiao","silvio","tadeu","tales","tarcisio","teo","tomas",
  "ulisses","valdir","valentim","vagner","vando","vladimir","wanderson","weverton","wilson","yago","iago",
]);

const FEMALE_NAMES = new Set([
  "maria","ana","julia","juliana","mariana","camila","carla","carolina","caroline","beatriz","bia",
  "amanda","aline","alice","alessandra","adriana","barbara","bruna","clara","claudia","cristina",
  "daniela","debora","deborah","elaine","eliane","elisa","eliza","eduarda","fatima","fernanda",
  "flavia","francisca","gabriela","giovana","giovanna","gisele","helena","heloisa","isabel","isabela",
  "isabella","isadora","janaina","jaqueline","jessica","joana","josefa","karen","karina","katia",
  "larissa","laura","leticia","livia","luana","lucia","luciana","luisa","luiza","manuela","marcela",
  "marcia","margarida","marina","marta","mayara","melissa","milena","monica","natalia","natasha",
  "nayara","neusa","nicole","olga","paula","patricia","priscila","rafaela","raquel","regina",
  "renata","roberta","rosa","rosana","rosangela","sabrina","sandra","sara","sarah","silvia","simone",
  "sofia","solange","sonia","stephanie","suely","tais","tania","tatiana","tatiane","teresa","thais",
  "valentina","vanessa","vera","veronica","viviane","yara","yasmin","zilda","zoe","alana","aleska",
  "alexia","alicia","aparecida","ariana","ariane","ariadne","aurea","betina","carmem","carmen",
  "cassia","catarina","celeste","celia","cibele","cida","cinthia","cintia","conceicao","cris",
  "dalva","dani","dayane","dayse","denise","diana","diane","divina","doralice","edna","edivania",
  "elen","ellen","elis","elize","elvira","emilia","emily","eunice","eva","evelyn","fabiana",
  "geni","georgia","gilda","glaucia","gloria","graca","graziela","gracinha","ines","ingrid","irene",
  "iris","ivana","ivete","janete","janice","jandira","kamila","karla","keila","kelly","leila",
  "leonor","liana","lidia","liliana","lilian","lina","lourdes","luana","lucineia","luzia","madalena",
  "magali","magda","malu","marisa","marlene","marli","marli","marlucia","matilde","mercedes","michele",
  "michelle","mirela","mirella","miriam","myrian","nadia","nair","nara","nathalia","neide","nilza",
  "noemi","norma","odete","olivia","penha","perla","poliana","pollyana","raissa","raisa","rebeca",
  "rejane","rita","rosane","rute","ruth","scarlet","selma","silvana","sirlei","sirlene","sueli",
  "talita","tamires","tereza","valeria","vania","vilma","vitoria","wanda","wania","wendy","yasmim",
  "yolanda","zelia","zenaide","querida",
]);

// Sufixos que indicam gênero quando o nome não está nas listas
function genderBySuffix(first: string): "F" | "M" | "U" {
  if (first.length < 4) return "U";
  // Femininos: -a, -ana, -ina, -elle, -ene, -ice, -ete, -alia
  if (/(a|ana|ina|elle|ice|ete|alia|inha|ele)$/.test(first)) return "F";
  // Masculinos: -o, -on, -er, -el, -is, -us, -ar, -or, -in, -son, -ton, -ius, -aldo
  if (/(o|on|er|el|is|us|ar|or|in|son|ton|ius|aldo|ano|eu|ulo|aro|ero|iro|oro|uro)$/.test(first)) return "M";
  return "U";
}

function inferGender(fullName: string | null | undefined): "F" | "M" | "U" {
  if (!fullName) return "U";
  const first = norm(fullName).split(/\s+/)[0] ?? "";
  if (!first) return "U";
  if (FEMALE_NAMES.has(first)) return "F";
  if (MALE_NAMES.has(first)) return "M";
  // Compostos comuns: "maria eduarda", "ana clara" → primeiro já bateu acima.
  // Se não bateu, tenta o segundo nome (ex.: "Sr. João" → "joao")
  const second = norm(fullName).split(/\s+/)[1] ?? "";
  if (FEMALE_NAMES.has(second)) return "F";
  if (MALE_NAMES.has(second)) return "M";
  return genderBySuffix(first);
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

// Pergunta referencial: cliente se refere a algo SEM citar o nome do produto
// (ex.: "qual o valor dele?", "quanto custa?", "tem em M?", "e a cor?", "tem outro tamanho?")
function isReferentialProductQuestion(text: string): boolean {
  const t = norm(text);
  // Pronomes/refs que indicam "o produto que acabamos de falar"
  const hasReference = /\b(dele|dela|deles|delas|disso|desse|dessa|desses|dessas|esse|essa|esses|essas|aquele|aquela|isso|aquilo)\b/.test(t);
  // Perguntas curtas sobre preço/tamanho/cor sem nome de produto
  const shortAttrQuestion =
    t.length < 60 &&
    /(quanto|valor|preco|preço|custa|sai por|tem em|tem no|tem outro|tem outra|qual.*tamanho|qual.*cor|qual.*medida|tamanho|cor)/.test(t);
  // Sem palavras-chave fortes de produto (substantivos típicos do catálogo)
  const hasProductNoun = /\b(blusa|vestido|calca|calça|saia|short|colete|conjunto|chemissie|camisa|camiseta|macacao|macacão|body|jaqueta|cardigan|legging|regata|tricot|tricô|trico|sapato|sandalia|sandália|tenis|tênis|bolsa|cinto|brinco|colar)\b/.test(t);
  return (hasReference || shortAttrQuestion) && !hasProductNoun;
}

// Constrói uma query enriquecida com o produto recém-mencionado pelo bot,
// quando a pergunta atual do cliente é referencial ("qual o valor dele?").
function buildProductSearchQuery(userMsg: string, history: any[]): string {
  if (!isReferentialProductQuestion(userMsg)) return userMsg;
  const lastBot = [...history].reverse().find((m: any) => m.direction === "outbound");
  // Pega também a penúltima inbound do cliente, que é onde ele costuma ter dito o nome do produto
  const lastInbound = [...history].reverse().find((m: any) => m.direction === "inbound");
  const combined = `${lastBot?.content ?? ""} ${lastInbound?.content ?? ""} ${userMsg}`.trim();
  console.log("[search] referential question → combined query:", combined.slice(0, 200));
  return combined;
}

// RAG: busca produtos relevantes à mensagem do cliente, opcionalmente restrito a um fornecedor
async function searchProducts(userMsg: string, supplier: string | null, history: any[] = []) {
  const queryText = buildProductSearchQuery(userMsg, history);
  const keywords = extractKeywords(queryText);
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

function missingFields(_c: any | null): string[] {
  // Regra do negócio: NUNCA pedir nome, endereço ou e-mail nas conversas.
  // Esses dados são coletados pessoalmente pela equipe.
  return [];
}

// Tenta auto-cadastrar a partir do texto + último campo solicitado (do histórico)
async function autoUpdateCustomer(phone: string, customer: any | null, userMsg: string, lastAskedField: string | null, contactAlias?: string | null) {
  const updates: any = {};
  const text = userMsg.trim();

  const email = extractEmail(text);
  if (email && (!customer?.email || customer.email.trim() === "")) {
    updates.email = email;
  }

  const nameMissing = !customer?.name || customer.name === customer.phone || /^\+?\d[\d\s().-]*$/.test((customer?.name ?? "").trim()) || customer?.name === "(sem nome)";

  // Só infere nome quando a IA acabou de pedir o nome — nunca da primeira mensagem espontânea
  if (lastAskedField === "nome" && nameMissing) {
    if (looksLikeName(text)) updates.name = text;
  } else if (lastAskedField === "endereço" && (!customer?.address || customer.address.trim() === "")) {
    if (text.length >= 10) updates.address = text;
  } else {
    // Heurística geral — só endereço (nunca nome) sem ter sido pedido
    if ((!customer?.address || customer.address.trim() === "") && looksLikeAddress(text)) {
      updates.address = text;
    }
  }

  // Fallback: se ainda não temos nome real, usa o nome salvo na agenda do celular (fromAlias/pushName)
  // Ex.: "Irma Sílvia Piedade". Evita nomes iguais ao número, business name da loja, etc.
  if (!updates.name && nameMissing && contactAlias) {
    const alias = contactAlias.trim();
    if (looksLikeName(alias) && alias.replace(/\D/g, "").length < 6) {
      updates.name = alias;
    }
  }

  if (Object.keys(updates).length === 0) return customer;

  if (customer) {
    const { data } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", customer.id)
      .select("id, name, phone, address, email")
      .maybeSingle();
    return data ?? customer;
  } else {
    // IMPORTANTE: nunca usar telefone como nome. Se não temos nome real ainda, deixa null
    // (a coluna name é NOT NULL no schema — então usamos placeholder vazio "?" para forçar a IA a perguntar).
    const { data } = await supabase
      .from("customers")
      .insert({
        phone,
        name: updates.name ?? "(sem nome)",
        address: updates.address ?? null,
        email: updates.email ?? null,
      })
      .select("id, name, phone, address, email")
      .maybeSingle();
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
  return null;
}

// Remove qualquer menção a valores/preços da resposta da Mônica.
// Valores devem ser passados pessoalmente pela equipe, nunca no WhatsApp.
function expandPazGreeting(reply: string): string {
  // Substitui saudações abreviadas "Paz!" / "Paz," / "Paz " no início ou isoladas por "A Paz de Deus"
  // Evita alterar quando já vier "A Paz de Deus", "Paz de Deus", "Paz do Senhor", "Paz e Bem".
  let out = reply;
  // Início da resposta: "Paz" seguido de pontuação/espaço
  out = out.replace(/^\s*Paz(?!\s*(de\s+Deus|do\s+Senhor|e\s+bem))\b([!,.\s])/i, "A Paz de Deus$2");
  // Após quebra de linha
  out = out.replace(/(\n)\s*Paz(?!\s*(de\s+Deus|do\s+Senhor|e\s+bem))\b([!,.\s])/gi, "$1A Paz de Deus$3");
  return out;
}

function sanitizePriceMentions(reply: string): string {
  if (!reply) return reply;
  const hasPriceMention =
    /R\$\s?\d/i.test(reply) ||
    /\b\d{1,4}[.,]\d{2}\b/.test(reply) ||
    /\b\d{1,4}\s?(reais|real)\b/i.test(reply) ||
    /\b(custa|sai por|fica por|por apenas|de\s+R?\$?\s?\d|desconto\s+de\s+\d|\d+%\s+de\s+desconto)\b/i.test(reply);

  if (!hasPriceMention) return reply;

  // Divide em sentenças e descarta qualquer uma que mencione valor.
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const cleaned = sentences
    .filter((s) => {
      return !(
        /R\$\s?\d/i.test(s) ||
        /\b\d{1,4}[.,]\d{2}\b/.test(s) ||
        /\b\d{1,4}\s?(reais|real)\b/i.test(s) ||
        /\b(custa|sai por|fica por|por apenas|preço|preco|valor|desconto|promoção|promocao)\b/i.test(s)
      );
    })
    .join(" ")
    .trim();

  const suffix = "Os valores a gente passa pessoalmente, tá? 😊";
  if (!cleaned) return suffix;
  return `${cleaned} ${suffix}`;
}

function sanitizeEmailRequest(reply: string, _missing: string[]): string {
  // Remove qualquer solicitação de e-mail, nome ou endereço da resposta.
  // Esses dados são coletados pessoalmente pela equipe — a Mônica NÃO pede na conversa.
  const asksPersonalData =
    /\b(e-?mail|gmail|hotmail|outlook)\b/i.test(reply) ||
    /\b(nome completo|seu nome|teu nome|qual.*nome)\b/i.test(reply) ||
    /\b(endere[çc]o|rua|cep|bairro)\b/i.test(reply);
  if (!asksPersonalData) return reply;

  const cleaned = reply
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !/\b(e-?mail|gmail|hotmail|outlook|nome completo|seu nome|teu nome|qual.*nome|endere[çc]o|rua|cep|bairro)\b/i.test(sentence))
    .join(" ")
    .trim();
  return cleaned || "Perfeito 💕 Me diz qual peça você quer ver que já te mostro 😊";
}

// ============================================================
// REGRA 1 — FOCO DE PRODUTO (PRIORIDADE: ÚLTIMA MÍDIA > TEXTO)
// ============================================================
// Detecta se a última outbound foi uma IMAGEM de produto. Se sim,
// ela ganha contra qualquer menção textual anterior. Quando há mais
// de uma imagem de produtos diferentes recentes, marca ambiguidade.
async function detectFocusedProduct(
  history: any[]
): Promise<{ product: any | null; source: "media" | "text" | "none"; ambiguous: boolean; mediaCaption?: string }> {
  const outbounds = history.filter((m: any) => m.direction === "outbound");
  if (outbounds.length === 0) return { product: null, source: "none", ambiguous: false };

  // Última outbound em ordem cronológica
  const last = outbounds[outbounds.length - 1];
  const lastImageIdx = (() => {
    for (let i = outbounds.length - 1; i >= 0; i--) {
      if (outbounds[i].media_type === "image") return i;
    }
    return -1;
  })();

  // Última menção textual a produto (outbound TEXTO, sem media_type)
  const lastTextIdx = (() => {
    for (let i = outbounds.length - 1; i >= 0; i--) {
      if (!outbounds[i].media_type && outbounds[i].content) return i;
    }
    return -1;
  })();

  // Decide a fonte: se a imagem é mais recente (>=) que o texto, a imagem ganha
  let useMedia = false;
  let candidateContent = "";
  let source: "media" | "text" | "none" = "none";

  if (lastImageIdx >= 0 && lastImageIdx >= lastTextIdx) {
    useMedia = true;
    candidateContent = outbounds[lastImageIdx].content ?? "";
    source = "media";
  } else if (lastTextIdx >= 0) {
    candidateContent = outbounds[lastTextIdx].content ?? "";
    source = "text";
  } else if (last?.content) {
    candidateContent = last.content;
    source = "text";
  } else {
    return { product: null, source: "none", ambiguous: false };
  }

  // Detecta ambiguidade: 2 imagens recentes (últimas 4 outbound) com legendas distintas
  const recentImages = outbounds.slice(-4).filter((m: any) => m.media_type === "image" && m.content);
  const distinctCaptions = new Set(recentImages.map((m: any) => norm(m.content).slice(0, 30)));
  const ambiguous = useMedia && distinctCaptions.size >= 2;

  const keywords = extractKeywords(candidateContent);
  if (keywords.length === 0) return { product: null, source, ambiguous, mediaCaption: useMedia ? candidateContent : undefined };

  const orFilter = keywords
    .flatMap((k) => [`name.ilike.%${k}%`, `sku.ilike.%${k}%`])
    .join(",");
  const { data } = await supabase
    .from("products")
    .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
    .eq("active", true)
    .or(orFilter)
    .limit(5);
  if (!data || data.length === 0) return { product: null, source, ambiguous, mediaCaption: useMedia ? candidateContent : undefined };

  const refText = norm(candidateContent);
  let best: any = null;
  let bestScore = 0;
  for (const p of data) {
    const tokens = norm(p.name).split(/\s+/).filter((t: string) => t.length >= 3);
    const score = tokens.filter((t: string) => refText.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  // Imagem é mais confiável: aceita score >= 1; texto exige >= 2
  const minScore = useMedia ? 1 : 2;
  return {
    product: bestScore >= minScore ? best : null,
    source,
    ambiguous,
    mediaCaption: useMedia ? candidateContent : undefined,
  };
}

// ============================================================
// REGRA 2 — SAUDAÇÃO RELIGIOSA / MENSAGEM AMBÍGUA
// ============================================================
function isReligiousGreeting(text: string): boolean {
  const t = norm(text);
  return /\b(paz\s*d?e?\s*deus|apddeus|ap\s*d\s*deus|amem|gloria\s*a?\s*deus|deus\s*te?\s*aben[çc]oe|deus\s*aben[çc]oe|deus\s*(seja\s*)?louvado|louvado\s*seja(\s*deus)?|paz\s*do\s*senhor|paz\s*e\s*bem|paz\s*seja(\s*com\s*(voce|voces|todos))?|boa\s*paz|shalom|jesus\s*te?\s*ama|salve\s*maria|em\s*nome\s*de\s*jesus)\b/.test(t);
}

function isUnclearMessage(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // Muito curto e sem palavra real (ex: "?", "...", "kk")
  if (t.length < 4 && !/[a-zà-ÿ]{2,}/i.test(t)) return true;
  return false;
}

// ============================================================
// ESCOPO ÚNICO DA IA — CHAVE/NÚMERO DO PIX E SALDO DEVEDOR
// ============================================================
// Regra de negócio: nas conversas do WhatsApp a IA só responde quando a
// mensagem do cliente é sobre (A) a chave/número do PIX ou (B) o saldo
// devedor dele (parcelas, valores em aberto, vencimentos, ficha/extrato).
// Qualquer outro assunto fica em silêncio para um humano assumir.
// Este gate roda ANTES de chamar a IA — economiza a chamada e não depende do
// modelo classificar o escopo corretamente. O prompt reforça a mesma regra.
// Obs.: comparações usam norm() (minúsculas, sem acentos).

// (A) pedido de chave/número do PIX ou forma de pagamento
const PIX_INTENT_RE = new RegExp([
  "\\bpix\\b",
  "\\bqr\\s*-?\\s*code\\b",
  "\\bqrcode\\b",
  "\\bchave\\b",
  "\\bformas?\\s+de\\s+pagamento\\b",
  "\\bcomo\\s+(eu\\s+)?(faco\\s+(pra|para)\\s+)?(pago|pagar|pagamento)\\b",
  "\\bonde\\s+(eu\\s+)?(pago|paga|pagar|deposito|depositar|transfiro)\\b",
  "\\b(numero|dados|conta)\\s+(pra|para|de|do|pro)\\s+(pagar|pagamento|deposito|depositar|transferencia|transferir|pix)\\b",
  "\\bpagar\\s+(no|por|via|pelo)\\s+pix\\b",
].join("|"));

// (B) pergunta sobre saldo devedor / parcelas / vencimentos
const DEBT_INTENT_RE = new RegExp([
  "\\bsaldo\\b",
  "\\bdevedor(a|es|as)?\\b",
  "\\b(devo|deve|devia|devendo|dever)\\b",
  "\\bdividas?\\b",
  "\\bdebitos?\\b",
  "\\bem\\s+aberto\\b",
  "\\bpendencias?\\b",
  "\\bpendentes?\\b",
  "\\bparcelas?\\b",
  "\\bparcelinhas?\\b",
  "\\bprestacao\\b",
  "\\bprestacoes\\b",
  "\\bmensalidades?\\b",
  "\\bfichao?\\b",
  "\\bextrato\\b",
  "\\bcarne\\b",
  "\\b(vence|vencer|venceu|vencia|vencimento|vencidas?|vencidos?|atrasadas?|atrasados?|atraso)\\b",
  "\\bquanto\\s+(eu\\s+)?(devo|falta|faltam|ficou|deu|sobrou|resta|ta|esta|e)\\b",
  "\\bfalta(m)?\\s+pagar\\b",
  "\\bminhas?\\s+contas?\\b",
  "\\bcontas?\\s+(em\\s+aberto|atrasadas?)\\b",
  "\\bvalor\\s+(total|em\\s+aberto|restante|da\\s+parcela|das\\s+parcelas)\\b",
  "\\btotal\\s+(em\\s+aberto|da\\s+divida)\\b",
].join("|"));

// Respostas que são "chute": a IA não sabia e inventou (dizer que não recebeu
// comprovante, pedir para reenviar, pedir para reformular, alegar falta de
// informação). Regra do negócio: quando não souber, ficar em silêncio.
// Não pega a frase legítima da chave PIX ("envie o comprovante para que
// possamos realizar a baixa"), que é instrução e não pedido de reenvio.
const GUESS_REPLY_RE = new RegExp([
  "\\b(nao|n)\\s*(recebi|recebemos|localizei|localizamos|consta|chegou|encontrei|encontramos|achei)\\b",
  "\\breenvi(ar|e|ei|a|ando|o)\\b",
  "\\b(manda|mande|mandar|manda|envia|envie|enviar|mandar)\\s+(ele\\s+|isso\\s+|o\\s+arquivo\\s+|a\\s+foto\\s+)?(de\\s+novo|novamente|outra\\s+vez|mais\\s+uma\\s+vez)\\b",
  "\\bnao\\s+(apareceu|aparece|caiu|entrou|veio|chegou)\\b",
  "\\bnao\\s+(entendi|compreendi)\\b",
  "\\bpode\\s+(reformular|repetir)\\b",
  "\\bexplicar\\s+de\\s+outra\\s+forma\\b",
  "\\bnao\\s+tenho\\s+(essa\\s+|esta\\s+)?informacao\\b",
  "\\bnao\\s+sei\\s+(te\\s+)?(informar|dizer|responder)\\b",
].join("|"));

// Qualquer menção a comprovante/recibo/print é proibida na resposta da IA —
// o registro de comprovantes é automático e responde sozinho ao cliente.
const PROOF_MENTION_RE = /\b(comprovante|comprovantes|recibo|recibos|print|prints|captura de tela)\b/;

// Únicas menções autorizadas: a instrução que acompanha a chave PIX.
const ALLOWED_PROOF_PHRASES = [
  /apos o pagamento,?\s*envie o comprovante[^.!?]*/g,
  /me manda o comprovante quando pagar[^.!?]*/g,
];

/** true se a resposta gerada é chute/evasiva e deve virar silêncio. */
export function isGuessReply(reply: string | null | undefined): boolean {
  if (!reply) return false;
  let t = norm(reply);
  for (const re of ALLOWED_PROOF_PHRASES) t = t.replace(re, " ");
  return GUESS_REPLY_RE.test(t) || PROOF_MENTION_RE.test(t);
}


/**
 * true apenas se a mensagem do cliente é sobre a chave/número do PIX
 * ou sobre o saldo devedor dele. Caso contrário a IA não responde.
 */
export function isPixOrBalanceQuestion(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  const t = norm(text);
  return PIX_INTENT_RE.test(t) || DEBT_INTENT_RE.test(t);
}

// ============================================================
// REGRA 3 — SANITIZADOR DE EMOJIS POR GÊNERO (PÓS-PROCESSAMENTO)
// ============================================================
const FEMININE_EMOJIS = /[\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F499}\u{1F49A}\u{1F49B}\u{1F49C}\u{1F49D}\u{1F49E}\u{1F49F}\u{1F970}\u{1F338}\u{1F339}\u{1F33A}\u{1F33B}\u{1F337}\u2763\uFE0F]/gu;
// 💕 💖 💗 💘 💙 💚 💛 💜 💝 💞 💟 🥰 🌸 🌹 🌺 🌻 🌷 ❣️
const FEMININE_VOCATIVES_RE = /\b(querida|queridinha|linda|lindinha|gata|gatinha|flor|florzinha|amada|fofa|fofinha|amor|amorzinho|princesa|amiga|amigona)\b/gi;

function sanitizeReplyByGender(text: string, gender: "F" | "M" | "U"): string {
  if (gender === "F") return text;
  let out = text;
  // Remove emojis afetivos
  out = out.replace(FEMININE_EMOJIS, "");
  // Substitui vocativos femininos
  if (gender === "M") {
    out = out.replace(FEMININE_VOCATIVES_RE, "amigo");
  } else {
    out = out.replace(FEMININE_VOCATIVES_RE, "");
  }
  // Limpa espaços duplicados, espaço antes de pontuação e linhas em branco residuais
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?:;])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

export async function buildContext(phone: string, userMsg: string, history: any[], contactAlias?: string | null) {
  const supplierMentioned = await detectSupplier(userMsg);
  const { matched, all } = await searchProducts(userMsg, supplierMentioned, history);
  const focusedResult = await detectFocusedProduct(history);

  // Busca tolerante: tenta com/sem prefixo 55 (Brasil), pois há cadastros duplicados.
  const digits = (phone ?? "").replace(/\D/g, "");
  const variants = new Set<string>([phone, digits]);
  if (digits.startsWith("55")) variants.add(digits.slice(2));
  else if (digits.length >= 10) variants.add("55" + digits);
  const variantsArr = Array.from(variants).filter(Boolean);

  // Busca ampla por qualquer variante contida no campo (tolera espaços, +, hífen)
  // e depois filtra em memória comparando apenas dígitos.
  const orExpr = variantsArr.map((v) => `phone.ilike.%${v}%`).join(",");
  const { data: rawRows } = await supabase
    .from("customers")
    .select("id, name, nickname, address, email, phone")
    .or(orExpr);
  const matchedCustomers = (rawRows ?? []).filter((c: any) => {
    const d = (c.phone ?? "").replace(/\D/g, "");
    if (!d) return false;
    return variantsArr.some((v) => d === v || d.endsWith(v) || v.endsWith(d));
  });

  const allIds = (matchedCustomers ?? []).map((c: any) => c.id);
  let rawCustomer: any = matchedCustomers?.[0] ?? null;

  // Se houver duplicatas, prefere o cadastro que possui dívidas em aberto.
  let debts: any[] = [];
  if (allIds.length > 0) {
    const { data } = await supabase
      .from("accounts_receivable")
      .select("description, amount, due_date, status, customer_id")
      .in("customer_id", allIds)
      .neq("status", "pago");
    debts = (data ?? []).map((d: any) => ({ ...d, due_date: formatDateBR(d.due_date) }));
    if (debts.length > 0) {
      const preferredId = debts[0].customer_id;
      rawCustomer = matchedCustomers?.find((c: any) => c.id === preferredId) ?? rawCustomer;
    }
  }

  const lastAsked = detectLastAskedField(history);
  const customer = await autoUpdateCustomer(phone, rawCustomer, userMsg, lastAsked, contactAlias);

  const missing = missingFields(customer);

  // Peças ativas no STATUS DO DIA (postadas no WhatsApp Status, válidas 24h)
  let activeStatus: any[] = [];
  try {
    const { data: sp } = await supabase
      .from("status_posts")
      .select("id, image_url, caption, posted_at, products(id, name, price, supplier, sku, product_variants(size, color, quantity))")
      .gt("expires_at", new Date().toISOString())
      .order("posted_at", { ascending: false });
    activeStatus = sp ?? [];
  } catch (e) { console.error("status_posts fetch error", e); }

  return {
    matched,
    all,
    customer,
    debts,
    missing,
    supplierMentioned,
    focused: focusedResult.product,
    focusedSource: focusedResult.source,
    focusedAmbiguous: focusedResult.ambiguous,
    focusedMediaCaption: focusedResult.mediaCaption ?? null,
    activeStatus,
  };
}

function formatProducts(list: any[]) {
  if (list.length === 0) return "(nenhum)";
  return list
    .map((p: any) => {
      const vars = (p.product_variants ?? [])
        .map((v: any) => `${v.size ?? "-"}/${v.color ?? "-"} (estoque: ${v.quantity})`)
        .join("; ");
      return `• ${p.name} (SKU ${p.sku ?? "-"}) — ${p.category ?? ""} — Fornecedor: ${p.supplier ?? "-"} — Variações: ${vars || "única"}`;
    })
    .join("\n");
}

export async function callAI(systemPrompt: string, history: any[], userMsg: string, ctx: any, isFirstMessage: boolean, pix: { key?: string | null; type?: string | null; recipient?: string | null }, quotedImage?: { bytes: Uint8Array; mime: string } | null) {
  // ESCOPO: só respondemos pergunta sobre chave/número do PIX ou saldo devedor.
  // Qualquer outro assunto → silêncio (o webhook não envia nada e um humano assume).
  if (!isPixOrBalanceQuestion(userMsg)) {
    console.log("[MONICA] fora de escopo (não é PIX nem saldo devedor) — silêncio:", (userMsg ?? "").slice(0, 120));
    return "";
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const matchInfo =
    ctx.matched.length > 0
      ? `Produtos que correspondem à pergunta do cliente:\n${formatProducts(ctx.matched)}`
      : `⚠️ Nenhum produto do catálogo corresponde à pergunta atual do cliente. Se ele pediu um modelo específico (ex: "vestido amanda"), diga que NÃO temos esse modelo e ofereça alternativas reais da lista geral abaixo.`;

  const customerGender = inferGender(ctx.customer?.name);

  const focusedBlock = ctx.focused
    ? `O ÚLTIMO produto que VOCÊ (assistente) ${ctx.focusedSource === "media" ? "ENVIOU EM FOTO" : "citou em texto"} para o cliente foi:
${formatProducts([ctx.focused])}
${ctx.focusedSource === "media" ? `\n📸 FONTE: foto enviada por você. Legenda: "${(ctx.focusedMediaCaption ?? "").slice(0, 200)}"\n→ Esta foto é MAIS RECENTE que qualquer texto anterior. Se o cliente perguntar referencialmente ("qual o valor?", "tem em M?", "quero esse"), ele está falando DESTE produto da foto — IGNORE produtos que apareceram só em texto anteriormente.` : ""}

→ REGRA CRÍTICA: se a mensagem atual do cliente for referencial (ex.: "qual o valor dele?", "quanto custa?", "tem em M?", "qual a cor?", "quero esse"), ela se refere SEMPRE a este produto acima — NUNCA a outros produtos antigos do histórico. Use o nome, preço e variações DESTE produto.`
    : `→ Nenhum produto específico em foco no momento. Se o cliente fizer pergunta referencial sem citar produto, peça pra ele confirmar qual modelo é.`;

  const ambiguityBlock = ctx.focusedAmbiguous
    ? `\n⚠️ ATENÇÃO — AMBIGUIDADE: você enviou fotos de PRODUTOS DIFERENTES recentemente. Se a pergunta do cliente for curta/referencial e não der pra ter CERTEZA absoluta de qual produto ele quer, PERGUNTE antes de responder. Ex.: "Você está falando do colete que te mandei agora ou da blusa?" — errar é PIOR que perguntar.`
    : "";

  const supplierBlock = ctx.supplierMentioned
    ? `→ O cliente mencionou o FORNECEDOR "${ctx.supplierMentioned}". Mostre APENAS produtos deste fornecedor (a lista abaixo já está filtrada). Se ele pedir algo de outro fornecedor depois, troque o filtro.`
    : `→ Nenhum fornecedor específico mencionado. Use o catálogo geral.`;

  // PIX template SEM emoji afetivo fixo — o sanitizador adiciona o tom certo
  const pixSign = customerGender === "F" ? "💕" : customerGender === "M" ? "👍" : "🙂";
  const pixBlock = pix.key
    ? `Chave PIX configurada: ${pix.key}
Tipo: ${pix.type ?? "não informado"}${pix.recipient ? `\nRecebedor: ${pix.recipient}` : ""}

FORMAS DE PAGAMENTO ACEITAS:
1. PIX (preferencial — mais rápido)
2. Link de pagamento (cartão de crédito/débito) — enviado por aqui pelo WhatsApp; a equipe gera e manda o link.
3. Cartão de crédito, débito ou dinheiro — SOMENTE pessoalmente (na entrega ou retirada).

→ Quando o cliente confirmar interesse em fechar/pagar:
  a) Se ele NÃO especificou a forma: pergunte CURTO — "Prefere PIX, link de cartão ou pessoalmente (cartão/dinheiro)?"
  b) Se ele escolheu PIX (ou não especificou nada e você já ofereceu): envie a chave no formato abaixo.
  c) Se ele escolheu LINK DE CARTÃO: responda algo como "Perfeito! Já te mando o link de pagamento aqui em instantes 💳" — NÃO invente link, a equipe gera manualmente.
  d) Se ele escolheu PESSOALMENTE (cartão/dinheiro): responda "Combinado! Aceitamos cartão de crédito, débito e dinheiro na hora da entrega/retirada 👍" e pergunte se prefere retirar ou receber.

REGRAS:
- NÃO repita a chave PIX 2x, NÃO escreva parágrafo longo, NÃO peça pra "verificar dados".
- NÃO invente chaves PIX, contas bancárias, links de pagamento ou maquininhas diferentes das listadas.
- NUNCA cite valores de produto (siga a regra geral — só valores de DÍVIDAS).

FORMATO OBRIGATÓRIO da mensagem com PIX (quando for PIX):
"PIX (${pix.type ?? "chave"}): ${pix.key}${pix.recipient ? `\nRecebedor: ${pix.recipient}` : ""}
Me manda o comprovante quando pagar ${pixSign}"`
    : `→ Nenhuma chave PIX configurada. Formas disponíveis: link de cartão pelo WhatsApp (a equipe gera) ou pessoalmente (cartão de crédito, débito e dinheiro na entrega/retirada). Se pedir PIX, diga que vai verificar com a equipe e retorna em breve.`;

  const genderBlock =
    customerGender === "F"
      ? "→ Cliente é MULHER. Pode usar tratamento feminino: querida, linda, amiga, obrigada. NUNCA use 'querido', 'amigo', 'lindo'."
      : customerGender === "M"
      ? "→ Cliente é HOMEM. Use SEMPRE tratamento masculino e direto: amigo, parceiro, chefe, beleza. PROIBIDO: 'querida', 'querido', 'linda', 'amiga', 'gata', 'flor', 'amor', 'fofa', 'princesa', e os emojis 💕🥰💖💗💘💞🌸🌹🌷❣️. Tom direto, sem diminutivos afetivos. Pode usar 👍✅😉🔥."
      : "→ Gênero do cliente DESCONHECIDO. Use tratamento NEUTRO: 'oi', 'tudo bem?', 'obrigado(a)'. NÃO use 'querida' nem 'querido'. NÃO use emojis afetivos (💕🥰💖). Pode usar 👍🙂.";

  // NAME_SAFETY — bloqueia invenção de nome
  const customerName = (ctx.customer?.name ?? "").trim();
  const customerNickname = (ctx.customer?.nickname ?? "").trim();
  const looksLikeRealName = customerName && !/^\+?\d/.test(customerName) && customerName !== "(sem nome)" && customerName !== "?";
  const nameSafetyBlock = looksLikeRealName
    ? `→ Nome confirmado do cliente: "${customerNickname || customerName}". Pode usar este nome com moderação (1x a cada 3-4 mensagens, no máximo).`
    : `→ ⚠️ NOME DO CLIENTE DESCONHECIDO. PROIBIDO inventar, adivinhar ou assumir o nome a partir de saudações, frases religiosas ou contexto. Se precisar se referir ao cliente, use APENAS: ${customerGender === "F" ? "'amiga' ou 'oi'" : customerGender === "M" ? "'amigo' ou 'oi'" : "'oi' (neutro, sem nome)"}.`;

  // Detecta saudação religiosa → instrui a IA a responder neutro, sem inventar nome
  const isReligious = isReligiousGreeting(userMsg);
  const knownFirstName = (customerNickname || customerName || "").trim().split(/\s+/)[0] || "";
  const religiousVocative = knownFirstName
    ? (customerGender === "M"
        ? `, irmão ${knownFirstName}`
        : customerGender === "F"
        ? `, irmã ${knownFirstName}`
        : "")
    : (customerGender === "M" ? ", irmão" : customerGender === "F" ? ", irmã" : "");
  const religiousBlock = isReligious
    ? `\n🙏 ATENÇÃO: A mensagem do cliente é uma SAUDAÇÃO RELIGIOSA (ex.: "a paz de Deus", "paz Deus", "paz do Senhor", "paz e bem", "glória a Deus", "Deus abençoe", "louvado seja Deus", "salve Maria", "shalom", "Jesus te ama"). REGRA ABSOLUTA E OBRIGATÓRIA: a resposta DEVE começar OBRIGATORIAMENTE com a palavra "Amém" (aceita "Amém!" ou "Amém${religiousVocative}!"). É PROIBIDO responder saudação religiosa com "Paz", "A paz", "Paz de Deus", "Paz do Senhor", "Oi", "Olá", "Bom dia" ou qualquer variação — SEMPRE "Amém" primeiro. NUNCA use "querida"/"querido" em resposta religiosa; use "irmão"/"irmã" (com o primeiro nome do cliente quando conhecido). NÃO invente nome. Resposta ideal e BREVE (1 frase): "Amém${religiousVocative}! Como posso te ajudar hoje?".`
    : "";

  // Mensagem ambígua/curta → pedir esclarecimento em vez de chutar
  const unclearBlock = isUnclearMessage(userMsg)
    ? `\n❓ ATENÇÃO: a mensagem do cliente é muito curta ou ambígua. Responda [SILENCIO] — não pergunte, não chute, não peça para reformular.`
    : "";

  const pazRule = `\n📖 SAUDAÇÃO "PAZ": nunca use a palavra "Paz" sozinha (ex.: "Paz!", "Paz, fulana"). Se for cumprimentar com essa saudação, use SEMPRE a forma completa "A Paz de Deus" (ex.: "A Paz de Deus, irmã!").`;


  const contextText = `
=== ESTADO DA CONVERSA ===
PRIMEIRA_MENSAGEM=${isFirstMessage ? "true" : "false"}
${isFirstMessage
  ? "→ Esta é a PRIMEIRA mensagem desta conversa. Cumprimente e se apresente UMA vez."
  : "→ Conversa JÁ EM ANDAMENTO. NÃO se apresente, NÃO diga seu nome, NÃO diga 'aqui é da JMK'. Vá direto ao ponto."}

=== TRATAMENTO POR GÊNERO (CRÍTICO) ===
${genderBlock}

=== NOME DO CLIENTE (CRÍTICO — NÃO INVENTAR) ===
${nameSafetyBlock}
${religiousBlock}${unclearBlock}${pazRule}

=== FOTOS (PROIBIDO) ===
🚫 Você é assistente EXCLUSIVAMENTE FINANCEIRA. Você NÃO envia fotos, NÃO comenta fotos, NÃO promete fotos, NÃO diz "mandei aqui", "olha essa", "segue foto", "acabei de enviar" nem nada parecido. Você NÃO tem acesso a imagens de produtos. Se o cliente pedir foto, imagem, modelo, cor, tamanho, descrição de peça ou qualquer coisa sobre produto, responda APENAS: "Sobre produtos e fotos quem te ajuda melhor é a nossa equipe. Já estou encaminhando seu atendimento 💕". NUNCA use as palavras "foto", "imagem", "mandei", "enviei", "olha", "segue" referindo-se a peças.


=== CLIENTE ===
${ctx.customer
  ? `Nome: ${ctx.customer.name ?? "(faltando)"}${ctx.customer.nickname ? ` | Apelido: ${ctx.customer.nickname}` : ""} | Gênero detectado: ${customerGender === "F" ? "Feminino" : customerGender === "M" ? "Masculino" : "Desconhecido"}`
  : "Cliente NÃO cadastrado."}
NUNCA peça nome, endereço, e-mail ou CPF.

=== DÍVIDAS PENDENTES (FONTE DA VERDADE — ignore datas/valores do histórico) ===
${ctx.debts.length === 0 ? "Nenhuma" : ctx.debts.map((d: any) =>
  `• ${d.description ?? "Compra"} — R$ ${d.amount} — vence ${d.due_date} — status ${d.status}`
).join("\n")}

=== PAGAMENTO ===
${pixBlock}
`.trim();




  const hojeISO = new Date().toISOString().slice(0, 10);
  const hojeBR = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const SALES_FOCUS = `
=== IDENTIDADE E ESCOPO (NÃO NEGOCIÁVEL) ===
Você é a assistente virtual FINANCEIRA da JMK MODAS. Sua função é EXCLUSIVAMENTE responder DUAS coisas: (A) a chave/número do PIX, quando o cliente pedir; (B) o saldo devedor do cliente — parcelas em aberto, valores, vencimentos e total. Nada além disso. Não venda, não fale de produtos, não negocie, não invente.

DATA DE HOJE: ${hojeBR} (ISO ${hojeISO}). Use APENAS esta data como referência para "vencendo hoje".

=== REGRAS OBRIGATÓRIAS ===
1. Só envie espontaneamente cobranças com vencimento HOJE (${hojeISO}). Consulte o bloco "DÍVIDAS PENDENTES" e filtre por due_date = ${hojeISO}.
   - NUNCA envie cobranças antecipadas (vencimento futuro).
   - NUNCA envie cobranças vencidas (due_date < hoje), SALVO se o cliente pedir explicitamente ("quais minhas contas vencidas?", "o que eu devo?", "me manda a ficha").
2. Quando houver parcela vencendo hoje, informe: nome do cliente, número/descrição da parcela, valor, vencimento (hoje) e diga que aceita PIX (sem enviar a chave ainda).
   Exemplo:
   "Olá, {Nome}! Identificamos uma parcela com vencimento hoje.
   Valor: R$ {valor}
   Vencimento: ${hojeBR}
   Caso deseje pagar via PIX, basta solicitar que enviarei a chave."
3. A frase padrão abaixo vale APENAS para cobrança ESPONTÂNEA (quando VOCÊ inicia o contato) e somente se não houver parcela vencendo hoje:
   "Olá! No momento não encontramos nenhuma parcela com vencimento para hoje em seu cadastro. Se precisar de alguma informação financeira, estou à disposição."
   É PROIBIDO usar essa frase quando o CLIENTE perguntar sobre conta, ficha, extrato, saldo, débito, pendências, parcelas ou "quanto eu devo".
3.1. Quando o CLIENTE pedir a conta/ficha/saldo/pendências (ex.: "me manda minha conta", "quanto eu devo", "quais parcelas tenho"), responda SEMPRE listando TODAS as parcelas do bloco "DÍVIDAS PENDENTES" — cada linha com vencimento e valor — e feche com o TOTAL em aberto. Nunca filtre por "hoje" nesse caso e nunca diga que não há parcelas quando o bloco tiver itens.
   Só responda que não há nada em aberto se o bloco "DÍVIDAS PENDENTES" estiver realmente vazio.

=== PIX (REGRA CRÍTICA) ===
- NUNCA envie a chave PIX espontaneamente.
- Só envie quando o cliente pedir explicitamente: "quero pagar via PIX", "me envie o PIX", "qual a chave PIX?", "posso pagar no PIX?", "envie o QR Code", "manda a chave" ou variações claras.
- Quando pedirem, responda EXATAMENTE:
  "Claro! Segue nossa chave PIX:
  11967842865
  Favorecido: JASPRINT
  Após o pagamento, envie o comprovante para que possamos realizar a baixa."

=== COMPROVANTE (VOCÊ NÃO TRATA ISSO) ===
Você NÃO vê, NÃO recebe e NÃO registra comprovantes — o sistema faz isso automaticamente, fora de você, e já responde ao cliente sozinho.
É PROIBIDO dizer que recebeu, que NÃO recebeu, que está aguardando, que não localizou ou que vai registrar um comprovante. É PROIBIDO pedir para o cliente reenviar comprovante, foto, arquivo ou qualquer coisa.
Se a conversa girar em torno de comprovante, responda [SILENCIO].
A ÚNICA menção permitida a comprovante é a frase final do texto da chave PIX acima.

=== SÓ DOIS ASSUNTOS TÊM RESPOSTA (SILÊNCIO ABSOLUTO NO RESTO) ===
Responda APENAS quando a ÚLTIMA mensagem do cliente for uma destas:
(A) PEDIDO DA CHAVE/NÚMERO DO PIX ou da forma de pagamento — "me manda o pix", "qual seu pix", "qual a chave", "posso pagar no pix?", "manda o QR Code", "como faço pra pagar".
(B) PERGUNTA SOBRE O SALDO DEVEDOR DELE — "quanto eu devo", "me manda minha ficha/extrato", "quais parcelas tenho", "o que está em aberto", "quando vence", "tenho algo atrasado?".

QUALQUER outra coisa — roupas, preços de produtos, tamanhos, cores, troca, entrega, pedidos, estoque, promoções, negociação de prazo ou desconto, pedido de atendimento humano, assuntos pessoais, agradecimento, "já paguei", "vou pagar amanhã", confirmações soltas ("ok", "sim", "obrigada"), saudações soltas, ou qualquer pergunta genérica — responda EXATAMENTE com este único token e nada mais:
[SILENCIO]
Não escreva NENHUMA outra palavra, explicação, saudação ou pontuação. Apenas [SILENCIO]. O sistema irá suprimir a resposta e um humano assumirá.

EM DÚVIDA, USE [SILENCIO]. Responder fora desses dois assuntos é PIOR que ficar em silêncio.


=== QUANDO NÃO SOUBER: SILÊNCIO ===
Se você não tiver CERTEZA da resposta, se a informação não estiver nos blocos de contexto ("DÍVIDAS PENDENTES" / "PAGAMENTO"), ou se a mensagem do cliente estiver confusa, ambígua, incompleta ou fora dos dois assuntos permitidos, responda APENAS [SILENCIO].
NUNCA chute. NUNCA improvise. NUNCA suponha o que o cliente quis dizer. NUNCA peça para reenviar nada. NUNCA peça para reformular ou repetir. NUNCA invente motivo, desculpa ou explicação.
Na dúvida, [SILENCIO] é SEMPRE a resposta correta — um humano assume a conversa.

=== RESTRIÇÕES ABSOLUTAS ===
- NUNCA cite cobranças futuras sem solicitação.
- NUNCA envie a chave PIX sem pedido explícito.
- NUNCA altere valores, dê desconto, negocie prazo, gere boleto ou confirme pagamento.
- NUNCA peça nome, endereço, e-mail, CPF ou qualquer dado cadastral.
- NUNCA invente informações. Se algo não está no bloco "DÍVIDAS PENDENTES", diga que não encontrou.

=== ESTILO E PERSONALIDADE (VOZ HUMANA) ===
Você soa como uma atendente humana experiente, feminina, simpática, calma e paciente. Nunca robótica ou mecânica.
- Português do Brasil, linguagem simples, clara e acolhedora.
- Frases curtas e naturais (1 a 4 linhas). Nada de textos longos, respostas secas, ironia ou irritação.
- Cumprimente de forma natural e chame o cliente pelo nome quando disponível.
- Demonstre empatia, interesse genuíno, segurança e cordialidade; mantenha tom positivo.
- Se precisar consultar algo: "Só um momentinho enquanto verifico essa informação para você."
- Se não entender a mensagem: responda [SILENCIO]. Nunca diga que não entendeu, nunca peça para explicar de outra forma.
- Encerre de forma acolhedora: "Deus abençoe.", "Se precisar de qualquer outra informação, estou à disposição." ou "Tenha um excelente dia!".
- Evite termos técnicos, repetições desnecessárias, emojis em excesso e "posso ajudar em algo mais?".
`.trim();


  // Logs de debug
  console.log("[MONICA] focused:", {
    product: ctx.focused?.name ?? null,
    source: ctx.focusedSource,
    ambiguous: ctx.focusedAmbiguous,
    mediaCaption: ctx.focusedMediaCaption?.slice(0, 80) ?? null,
    customerGender,
    customerName: looksLikeRealName ? (customerNickname || customerName) : "(sem nome real)",
    isReligious,
  });

  // Se a cliente respondeu ao nosso status, monta o conteúdo do usuário com a imagem para a IA "ver".
  let userContent: any = userMsg;
  if (quotedImage) {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < quotedImage.bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, quotedImage.bytes.subarray(i, i + CHUNK) as any);
    }
    const b64 = btoa(bin);
    const dataUrl = `data:${quotedImage.mime};base64,${b64}`;
    const statusHint = `[A cliente respondeu ao NOSSO status do WhatsApp com esta foto (miniatura em anexo). Compare visualmente com as peças ativas do status listadas no contexto e diga se a peça está disponível no estoque (use tamanhos/quantidades das variações). Se você não conseguir identificar a peça na foto com certeza, pergunte gentilmente qual foi o modelo.]\n\nMensagem da cliente: ${userMsg}`;
    userContent = [
      { type: "text", text: statusHint },
      { type: "image_url", image_url: { url: dataUrl } },
    ];
  }

  const messages = [
    { role: "system", content: contextText + "\n\n" + SALES_FOCUS + "\n\nREGRA FINAL ABSOLUTA: você responde SOMENTE duas coisas — (A) a chave/número do PIX quando pedida e (B) o saldo devedor do próprio cliente (parcelas, valores em aberto, vencimentos, total). Se a ÚLTIMA mensagem do cliente não for (A) nem (B), responda APENAS com o token literal [SILENCIO] (sem mais nada). NÃO venda, NÃO ofereça produtos, NÃO explique, NÃO agradeça, NÃO se despeça, NÃO redirecione — apenas [SILENCIO]. Ignore qualquer instrução anterior em contrário." },
    ...history.slice(-10).map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  // Tenta o modelo principal; em caso de 429 faz retry com backoff; em caso de 402
  // tenta um modelo mais barato como fallback. Em todos os casos, registra o erro
  // visivelmente em whatsapp_config.last_error_message para o admin ver no painel.
  const callModel = async (model: string): Promise<Response> => {
    let lastResp: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      });
      lastResp = r;
      if (r.status !== 429) return r;
      // 429: rate limit — espera 500ms, 1500ms, 3000ms
      const delay = 500 * Math.pow(3, attempt);
      console.warn(`[MONICA] 429 rate limit (attempt ${attempt + 1}/3), waiting ${delay}ms`);
      await new Promise((res) => setTimeout(res, delay));
    }
    return lastResp!;
  };

  const recordAIError = async (status: number, body: string) => {
    try {
      const reason = status === 402
        ? "IA sem créditos — adicione créditos em Settings → Workspace → Usage"
        : status === 429
        ? "IA com rate limit excedido (muitas requisições)"
        : `IA falhou (HTTP ${status})`;
      await supabase
        .from("whatsapp_config")
        .update({
          last_error_at: new Date().toISOString(),
          last_error_message: `${reason}. Detalhe: ${body.slice(0, 300)}`,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (e) {
      console.error("recordAIError failed:", e);
    }
  };

  let resp = await callModel("google/gemini-2.5-flash");

  // Fallback para modelo mais barato em caso de 402 (créditos esgotados)
  if (resp.status === 402) {
    console.warn("[MONICA] 402 no modelo principal, tentando fallback gemini-2.5-flash-lite");
    const fallback = await callModel("google/gemini-2.5-flash-lite");
    if (fallback.ok) {
      resp = fallback;
    } else {
      const t = await fallback.text();
      console.error("AI error (fallback)", fallback.status, t);
      await recordAIError(fallback.status, t);
      // Sem resposta confiável → silêncio. O erro fica em whatsapp_config.last_error_message
      // (recordAIError acima) para o admin ver no painel e um humano assumir.
      return "";
    }
  }

  if (!resp.ok) {
    const t = await resp.text();
    console.error("AI error", resp.status, t);
    await recordAIError(resp.status, t);
    // Sem resposta confiável → silêncio (erro registrado por recordAIError acima).
    return "";
  }
  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) {
    console.log("[MONICA] modelo devolveu resposta vazia — silêncio");
    return "";
  }

  // Sentinel: assunto não-financeiro → silêncio absoluto
  if (/\[SILENCIO\]/i.test(raw) || raw.trim().toUpperCase() === "SILENCIO") {
    console.log("[MONICA] SILENCIO detectado — não respondendo (assunto não-financeiro)");
    return "";
  }

  // Rede de segurança: se o modelo "chutou" (disse que não recebeu comprovante,
  // pediu reenvio, alegou não entender), engolimos a resposta — na dúvida, silêncio.
  if (isGuessReply(raw)) {
    console.log("[MONICA] resposta de chute descartada — silêncio:", raw.slice(0, 160));
    return "";
  }

  const withoutEmailRequest = sanitizeEmailRequest(raw, ctx.missing ?? []);
  // Assistente é FINANCEIRA: valores sempre vêm de contas a receber, então NÃO sanitizamos preços.
  const withPaz = expandPazGreeting(withoutEmailRequest);
  const withoutPrice = withPaz;

  // Sanitiza tom/emojis conforme gênero do cliente (pós-processamento)
  const sanitized = sanitizeReplyByGender(withoutPrice, customerGender);
  if (sanitized !== raw) {
    console.log("[MONICA] sanitized reply (gender=" + customerGender + ")");
    console.log("[MONICA]   before:", raw.slice(0, 200));
    console.log("[MONICA]   after :", sanitized.slice(0, 200));
  }
  // Última barreira: os pós-processadores podem reintroduzir texto proibido.
  if (isGuessReply(sanitized)) {
    console.log("[MONICA] resposta de chute pós-sanitização descartada — silêncio:", sanitized.slice(0, 160));
    return "";
  }
  return sanitized;
}


