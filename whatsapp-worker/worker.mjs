// Worker de WhatsApp da JMK MODAS — plano B para o BubbleWhats.
//
// Sobe o número da loja num Chrome local (whatsapp-web.js) e expõe, numa porta
// local, EXATAMENTE os mesmos endpoints da API do BubbleWhats que o JMKSYSTEM
// já usa. Assim, para virar o sistema para cá basta apontar a variável
// WHATSAPP_API_BASE das edge functions para a URL pública deste worker
// (túnel) — a Mônica, a IA, a voz, as fotos e a cobrança não mudam em nada.
//
// Endpoints emulados (ver supabase/functions/*):
//   POST /send-message     { jid, message }
//   POST /send-image       multipart: jid, caption, image (arquivo)
//   POST /send-audio       { jid, audiourl | audio }
//   POST /send-voice-note  { jid, audiourl }            -> áudio de voz (ptt)
//   POST /send-doc         { jid, docurl | document, filename }
//   GET  /status           { connected, status }
//   GET  /config           { receiveMessagesWebhook, receiveMessagesFromGroups }
//   POST /config           grava os dois campos acima
//
// Recebimento: cada mensagem que chega vira um POST no webhook configurado,
// no mesmo formato de payload que o BubbleWhats manda (ver
// supabase/functions/bubblewhats-webhook/index.ts).
//
// Uso no PC da loja:
//   npm install
//   npm start                      -> abre http://localhost:8099 com o QR code
//   npm start -- --teste 5511...   -> conecta, manda uma mensagem e sai
//
// Base: jasprint-flow/whatsapp-worker/worker.mjs, que roda em produção desde
// outubro/2026 (QR, reconexão e anti-bloqueio já provados ali).
import wweb from "whatsapp-web.js";
import QRCode from "qrcode";
import { exec } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import os from "node:os";

const { Client, LocalAuth, MessageMedia } = wweb;

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (existsSync(path.join(AQUI, ".env"))) process.loadEnvFile(path.join(AQUI, ".env"));

const PORTA_API = Number(process.env.PORTA_API ?? 8098);
const PORTA_QR = Number(process.env.PORTA_QR ?? 8099);
// Token que o JMKSYSTEM manda no header Authorization. Na virada, é o valor que
// passa a estar no segredo BUBBLEWHATS_TOKEN.
const API_TOKEN = process.env.API_TOKEN ?? "";
// URL pública deste worker (a do túnel). Entra no payload como o endereço de
// onde o webhook baixa a mídia recebida.
const BASE_PUBLICA = (process.env.BASE_PUBLICA ?? `http://localhost:${PORTA_API}`).replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
// Fora do OneDrive: a sessão do WhatsApp não pode ir para a nuvem.
const DADOS = path.join(os.homedir(), "AppData", "Local", "jmk-whatsapp");
const MIDIA = path.join(DADOS, "midia-temp");
// Espaçamento mínimo entre dois envios. Rajada é o que mais leva a bloqueio;
// a JMK manda ~35 mensagens por dia, então isso quase nunca atrasa a Mônica.
const GAP_MIN_MS = Number(process.env.GAP_MIN_MS ?? 3_000);
const GAP_MAX_MS = Number(process.env.GAP_MAX_MS ?? 8_000);
// Mídia recebida fica disponível para o webhook baixar por este tempo.
const MIDIA_TTL_MS = 60 * 60 * 1000;
const CONFIG_ARQ = path.join(DADOS, "config.json");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleString("pt-BR"), "-", ...a);
const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

const argNumero = (opcao) => {
  const i = process.argv.indexOf(opcao);
  if (i === -1) return null;
  const d = soDigitos(process.argv[i + 1]);
  if (!d) throw new Error(`Uso: npm start -- ${opcao} 5511999999999`);
  return d.length <= 11 ? `55${d}` : d;
};

// ---------------------------------------------------------------- configuração
// O endereço do webhook chega pelo POST /config (é o que a função
// bubblewhats-configure-groups faz, já com o ?k=<segredo> na URL). Fica salvo
// em disco para sobreviver a um reinício do PC.
let config = {
  receiveMessagesWebhook: process.env.WEBHOOK_URL ?? "",
  receiveMessagesFromGroups: String(process.env.RECEBER_GRUPOS ?? "true") === "true",
};
try {
  if (existsSync(CONFIG_ARQ)) config = { ...config, ...JSON.parse(readFileSync(CONFIG_ARQ, "utf8")) };
} catch (e) {
  log("não consegui ler a configuração salva:", e.message);
}
function salvarConfig() {
  try {
    writeFileSync(CONFIG_ARQ, JSON.stringify(config, null, 2));
  } catch (e) {
    log("não consegui salvar a configuração:", e.message);
  }
}

// ------------------------------------------------------------------- utilitário
/** Compara em tempo constante: evita vazar o token byte a byte. */
function tokenOk(recebido) {
  if (!API_TOKEN) return true; // sem token configurado, só escuta em localhost
  const a = Buffer.from(String(recebido ?? ""));
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lê o corpo cru da requisição, com teto de tamanho. */
function lerCorpo(req, maxBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("corpo muito grande"));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

/**
 * Separa um multipart/form-data em campos de texto e arquivos.
 * Escrito à mão de propósito: o worker não tem dependência além do
 * whatsapp-web.js e do qrcode, para a instalação na loja ser simples.
 */
function lerMultipart(corpo, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) throw new Error("multipart sem boundary");
  const limite = Buffer.from(`--${m[1] ?? m[2]}`);
  const campos = {};
  const arquivos = {};
  let pos = corpo.indexOf(limite);
  while (pos !== -1) {
    const inicio = pos + limite.length;
    if (corpo.slice(inicio, inicio + 2).toString() === "--") break; // fim
    const corteCabecalho = corpo.indexOf("\r\n\r\n", inicio);
    if (corteCabecalho === -1) break;
    const cabecalho = corpo.slice(inicio, corteCabecalho).toString("utf8");
    const proximo = corpo.indexOf(limite, corteCabecalho);
    const fim = proximo === -1 ? corpo.length : proximo - 2; // tira o \r\n antes do limite
    const valor = corpo.slice(corteCabecalho + 4, fim);
    const nome = /name="([^"]*)"/i.exec(cabecalho)?.[1];
    const arquivo = /filename="([^"]*)"/i.exec(cabecalho)?.[1];
    if (nome) {
      if (arquivo !== undefined) {
        arquivos[nome] = {
          nome: arquivo,
          mime: /Content-Type:\s*([^\r\n]+)/i.exec(cabecalho)?.[1]?.trim() ?? "application/octet-stream",
          bytes: valor,
        };
      } else {
        campos[nome] = valor.toString("utf8");
      }
    }
    pos = proximo;
  }
  return { campos, arquivos };
}

// ------------------------------------------------------------------ fila de envio
// Um envio por vez, com espaçamento mínimo entre eles. A resposta HTTP só sai
// depois do envio, igual ao BubbleWhats — assim o sistema continua sabendo na
// hora se a mensagem saiu.
let ultimoEnvio = 0;
let vez = Promise.resolve();
function naFila(tarefa) {
  const minha = vez.then(async () => {
    const gap = GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS);
    const espera = ultimoEnvio + gap - Date.now();
    if (espera > 0) await dormir(espera);
    try {
      return await tarefa();
    } finally {
      ultimoEnvio = Date.now();
    }
  });
  vez = minha.catch(() => {});
  return minha;
}

/**
 * Resolve o destino. Grupo vem como "...@g.us" e vai direto; número individual
 * passa pelo getNumberId, porque no Brasil o WhatsApp às vezes guarda o número
 * sem o nono dígito.
 */
async function resolverDestino(jid) {
  const cru = String(jid ?? "").trim();
  if (cru.includes("@g.us")) return cru;
  const digitos = soDigitos(cru);
  if (!digitos) throw new Error("jid vazio");
  const id = await client.getNumberId(digitos);
  if (!id) throw new Error(`número sem WhatsApp: ${digitos}`);
  return id._serialized;
}

/** Baixa uma URL (as do Storage são assinadas) e devolve o MessageMedia. */
async function baixarMidia(url, nomeSugerido) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`não consegui baixar a mídia: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  const nome = nomeSugerido || (new URL(url).pathname.split("/").pop() || "arquivo");
  return new MessageMedia(mime, bytes.toString("base64"), nome);
}

// ------------------------------------------------------- mídia recebida (servir)
// O webhook do JMKSYSTEM baixa a mídia de payload.url. O BubbleWhats serve essa
// URL; aqui o worker serve, com um id aleatório e validade de 1 hora.
mkdirSync(MIDIA, { recursive: true });
function guardarMidia(bytes, mime, nome) {
  const id = randomBytes(24).toString("hex");
  const ext = (nome?.split(".").pop() || mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8);
  const arquivo = path.join(MIDIA, `${id}.${ext}`);
  writeFileSync(arquivo, bytes);
  writeFileSync(`${arquivo}.mime`, mime);
  return `${BASE_PUBLICA}/media/${id}.${ext}`;
}
function limparMidiaVelha() {
  try {
    for (const nome of readdirSync(MIDIA)) {
      const arquivo = path.join(MIDIA, nome);
      if (Date.now() - statSync(arquivo).mtimeMs > MIDIA_TTL_MS) rmSync(arquivo, { force: true });
    }
  } catch (e) {
    log("limpeza da mídia temporária falhou:", e.message);
  }
}
setInterval(limparMidiaVelha, 15 * 60 * 1000).unref();

// --------------------------------------------------------- entregar no webhook
/** Entrega o payload no webhook configurado, com três tentativas. */
async function entregarNoWebhook(payload) {
  const url = config.receiveMessagesWebhook;
  if (!url) {
    log("mensagem recebida, mas nenhum webhook configurado — nada entregue.");
    return;
  }
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return;
      log(`webhook devolveu HTTP ${res.status} (tentativa ${tentativa})`);
      // 404 aqui quase sempre é URL registrada sem o ?k=<segredo>: o webhook
      // recusa de propósito. Repetir não resolve.
      if (res.status === 404) return;
    } catch (e) {
      log(`webhook falhou (tentativa ${tentativa}):`, e.message);
    }
    await dormir(2_000 * tentativa);
  }
}

/** Converte uma mensagem do whatsapp-web.js no payload do BubbleWhats. */
async function montarPayload(msg) {
  const chat = await msg.getChat().catch(() => null);
  const ehGrupo = Boolean(chat?.isGroup) || String(msg.from).includes("@g.us");
  const autor = soDigitos((ehGrupo ? msg.author : msg.from) ?? "");
  const contato = await msg.getContact().catch(() => null);

  const payload = {
    body: msg.body ?? "",
    caption: msg.body ?? "",
    fromNumber: autor,
    fromAlias: contato?.pushname || contato?.name || "",
    pushName: contato?.pushname || "",
    isGroup: ehGrupo,
    fromGroup: ehGrupo ? String(msg.from) : "",
    groupName: ehGrupo ? (chat?.name ?? "") : "",
    toNumber: soDigitos(client.info?.wid?.user ?? ""),
    timestamp: msg.timestamp,
    messageType: msg.type,
    fromMe: msg.fromMe === true,
    messageContext: {
      key: {
        remoteJid: String(msg.from),
        participant: ehGrupo ? String(msg.author ?? "") : "",
        fromMe: msg.fromMe === true,
        id: msg.id?.id ?? "",
      },
      messageTimestamp: msg.timestamp,
      pushName: contato?.pushname || "",
    },
  };

  // Mídia: baixa agora e publica numa URL temporária, como o BubbleWhats faz.
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media?.data) {
        const bytes = Buffer.from(media.data, "base64");
        payload.mimetype = media.mimetype ?? "application/octet-stream";
        payload.url = guardarMidia(bytes, payload.mimetype, media.filename);
        if (media.filename) payload.filename = media.filename;
      }
    } catch (e) {
      log("não consegui baixar a mídia recebida:", e.message);
    }
  }

  // Resposta a uma mensagem anterior (a Mônica usa isso para entender contexto).
  if (msg.hasQuotedMsg) {
    try {
      const citada = await msg.getQuotedMessage();
      payload.messageContext.message = {
        extendedTextMessage: {
          contextInfo: {
            stanzaId: citada.id?.id ?? "",
            participant: String(citada.from ?? ""),
            quotedMessage: { conversation: citada.body ?? "" },
          },
        },
      };
    } catch {
      // citação indisponível: segue sem ela
    }
  }

  return payload;
}

// ------------------------------------------------------------------ servidor API
function responder(res, status, corpo) {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(texto);
}

const servidorApi = createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const rota = url.pathname.replace(/\/$/, "") || "/";

  try {
    // Mídia recebida: sem token, como no BubbleWhats (o id aleatório é o segredo).
    if (req.method === "GET" && rota.startsWith("/media/")) {
      const nome = path.basename(rota.slice("/media/".length));
      const arquivo = path.join(MIDIA, nome);
      if (!existsSync(arquivo)) return responder(res, 404, { status: false, response: "não encontrado" });
      const mime = existsSync(`${arquivo}.mime`) ? readFileSync(`${arquivo}.mime`, "utf8") : "application/octet-stream";
      const bytes = readFileSync(arquivo);
      res.writeHead(200, { "Content-Type": mime, "Content-Length": bytes.length });
      return res.end(bytes);
    }

    // Todo o resto é a API: exige o token, igual ao BubbleWhats.
    const recebido = req.headers.authorization ?? req.headers.authentication ?? "";
    if (!tokenOk(recebido)) return responder(res, 401, { status: false, response: "token inválido" });

    if (req.method === "GET" && rota === "/status") {
      return responder(res, 200, {
        status: conectado ? "connected" : "disconnected",
        connected: conectado,
        state: conectado ? "CONNECTED" : "UNPAIRED",
        number: client.info?.wid?.user ?? null,
      });
    }

    if (rota === "/config") {
      if (req.method === "GET") return responder(res, 200, { status: true, ...config });
      if (req.method === "POST") {
        const corpo = JSON.parse((await lerCorpo(req)).toString("utf8") || "{}");
        if (typeof corpo.receiveMessagesWebhook === "string") {
          config.receiveMessagesWebhook = corpo.receiveMessagesWebhook;
          let temSegredo = false;
          try {
            temSegredo = new URL(corpo.receiveMessagesWebhook).searchParams.has("k");
          } catch {
            temSegredo = false;
          }
          log(
            "webhook registrado:",
            corpo.receiveMessagesWebhook.split("?")[0],
            temSegredo ? "(com segredo)" : "(SEM ?k= — o webhook vai recusar)",
          );
        }
        if (typeof corpo.receiveMessagesFromGroups === "boolean") {
          config.receiveMessagesFromGroups = corpo.receiveMessagesFromGroups;
        }
        salvarConfig();
        return responder(res, 200, { status: true, ...config });
      }
    }

    if (req.method !== "POST") return responder(res, 404, { status: false, response: "não encontrado" });
    if (!conectado) return responder(res, 503, { status: false, response: "WhatsApp não conectado" });

    // ---- texto ----
    if (rota === "/send-message") {
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8") || "{}");
      const destino = await resolverDestino(corpo.jid);
      const enviada = await naFila(() => client.sendMessage(destino, String(corpo.message ?? "")));
      log("texto enviado para", destino);
      return responder(res, 200, { status: true, id: enviada?.id?.id ?? null });
    }

    // ---- imagem (multipart, arquivo no campo "image") ----
    if (rota === "/send-image") {
      const corpo = await lerCorpo(req);
      const { campos, arquivos } = lerMultipart(corpo, req.headers["content-type"]);
      const arq = arquivos.image ?? arquivos.file ?? Object.values(arquivos)[0];
      if (!arq) return responder(res, 400, { status: false, response: "arquivo image ausente" });
      const destino = await resolverDestino(campos.jid);
      const media = new MessageMedia(arq.mime, arq.bytes.toString("base64"), arq.nome || "foto.jpg");
      const enviada = await naFila(() =>
        client.sendMessage(destino, media, campos.caption ? { caption: campos.caption } : undefined),
      );
      log("imagem enviada para", destino);
      return responder(res, 200, { status: true, id: enviada?.id?.id ?? null });
    }

    // ---- áudio comum, voz (ptt) e documento (todos por URL) ----
    if (rota === "/send-audio" || rota === "/send-voice-note" || rota === "/send-doc") {
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8") || "{}");
      const destino = await resolverDestino(corpo.jid);
      const link = corpo.audiourl ?? corpo.audio ?? corpo.docurl ?? corpo.document ?? corpo.url;
      if (!link) return responder(res, 400, { status: false, response: "URL do arquivo ausente" });
      const media = await baixarMidia(link, corpo.filename);
      const opcoes = rota === "/send-voice-note"
        ? { sendAudioAsVoice: true }
        : rota === "/send-doc"
          ? { sendMediaAsDocument: true }
          : undefined;
      const enviada = await naFila(() => client.sendMessage(destino, media, opcoes));
      log(rota, "enviado para", destino);
      return responder(res, 200, { status: true, id: enviada?.id?.id ?? null });
    }

    return responder(res, 404, { status: false, response: "não encontrado" });
  } catch (e) {
    log("erro na API", rota, "-", e.message);
    return responder(res, 500, { status: false, response: e.message });
  }
});

// ----------------------------------------------------------- cliente do WhatsApp
const contextoPerdido = (e) =>
  /Execution context was destroyed|Cannot find context with specified id/.test(String(e?.message ?? e));

// Na partida, o WhatsApp Web às vezes recarrega enquanto o whatsapp-web.js
// injeta o script, e o initialize() falha. Repete depois que a nova página
// carregar. (Igual ao worker do JASPRINT, onde isso acontecia na prática.)
const injetarOriginal = Client.prototype.inject;
Client.prototype.inject = async function () {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await injetarOriginal.call(this);
    } catch (e) {
      if (!contextoPerdido(e) || tentativa >= 5 || this.pupPage.listenerCount("framenavigated") > 0) throw e;
      log("WhatsApp Web recarregou durante a partida; tentando de novo.");
      await this.pupPage.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => {});
    }
  }
};

process.on("unhandledRejection", (e) => {
  if (contextoPerdido(e)) {
    log("WhatsApp Web recarregou a página; seguindo.");
    return;
  }
  console.error(e);
  process.exit(1);
});

// `--simular`: sobe só a API, sem abrir o WhatsApp. Serve para apontar as edge
// functions para cá e conferir que cada endpoint responde certo ANTES de mexer
// no número da loja — nada é enviado de verdade, só registrado no log.
const SIMULAR = process.argv.includes("--simular");

/** Dublê do Client: aceita os mesmos métodos e só registra o que faria. */
function clienteSimulado() {
  return {
    info: { wid: { user: "5511967842865" } },
    on() {},
    once() {},
    async initialize() {},
    async destroy() {},
    async getNumberId(numero) {
      return { _serialized: `${numero}@c.us`, user: numero };
    },
    async sendMessage(destino, conteudo, opcoes) {
      const que = typeof conteudo === "string"
        ? `texto (${conteudo.length} caracteres)`
        : `mídia ${conteudo?.mimetype ?? "?"} (${Math.round((conteudo?.data?.length ?? 0) * 0.75 / 1024)} KB)`;
      log("[SIMULAÇÃO] enviaria para", destino, "-", que, opcoes ? JSON.stringify(opcoes) : "");
      return { id: { id: `simulado-${Date.now()}` } };
    },
  };
}

mkdirSync(DADOS, { recursive: true });
const client = SIMULAR ? clienteSimulado() : new Client({
  authStrategy: new LocalAuth({ clientId: "jmk", dataPath: DADOS }),
  puppeteer: { headless: true, executablePath: CHROME },
  ...(argNumero("--parear") && {
    pairWithPhoneNumber: { phoneNumber: argNumero("--parear"), showNotification: true },
  }),
});

let qrAtual = null;
let codigoPareamento = null;
let conectado = false;
let paginaAberta = false;

// Página local com o QR atual (o WhatsApp troca o código a cada ~20 s).
createServer(async (_req, res) => {
  const corpo = conectado
    ? "<h1>WhatsApp conectado</h1><p>Pode fechar esta página.</p>"
    : codigoPareamento
      ? `<h1>Digite no celular da loja</h1>
         <p>WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho &gt; Conectar com número de telefone</p>
         <p style="font-size:56px;letter-spacing:8px;font-weight:bold">${codigoPareamento.slice(0, 4)}-${codigoPareamento.slice(4)}</p>`
      : qrAtual
        ? `<h1>Leia com o celular da loja</h1><p>WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</p>
           <img src="${await QRCode.toDataURL(qrAtual, { width: 420, margin: 2 })}" alt="QR code">`
        : "<h1>Carregando o WhatsApp…</h1>";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta http-equiv="refresh" content="3"><title>JMK WhatsApp</title>
    <body style="font-family:sans-serif;text-align:center;padding:24px">${corpo}</body>`);
}).listen(PORTA_QR, "127.0.0.1");

client.on("qr", (qr) => {
  qrAtual = qr;
  if (paginaAberta) return;
  paginaAberta = true;
  log(`Leia o QR code em http://localhost:${PORTA_QR}`);
  exec(`start "" http://localhost:${PORTA_QR}`);
});
client.on("code", (codigo) => {
  codigoPareamento = codigo;
  log(`Código para digitar no celular: ${codigo}`);
  if (!paginaAberta) {
    paginaAberta = true;
    exec(`start "" http://localhost:${PORTA_QR}`);
  }
});
client.on("auth_failure", (m) => log("falha na autenticação:", m));
client.on("disconnected", (motivo) => {
  conectado = false;
  log("WhatsApp desconectado:", motivo);
  process.exit(1); // o iniciar.cmd sobe de novo
});

// Mensagem de cliente. message_create pega também o que a equipe digita no
// celular (fromMe) — o webhook do JMKSYSTEM já trata esse eco e não deixa a
// Mônica responder a si mesma, então entregamos os dois.
client.on("message_create", async (msg) => {
  try {
    const ehGrupo = String(msg.from).includes("@g.us") || String(msg.to).includes("@g.us");
    if (ehGrupo && !config.receiveMessagesFromGroups) return;
    if (String(msg.from) === "status@broadcast") return;
    const payload = await montarPayload(msg);
    await entregarNoWebhook(payload);
  } catch (e) {
    log("erro ao tratar mensagem recebida:", e.message);
  }
});

if (SIMULAR) {
  conectado = true;
  log("MODO SIMULAÇÃO: o WhatsApp não foi aberto e nada será enviado de verdade.");
} else {
  const pronto = new Promise((r) => client.once("ready", r));
  await client.initialize();
  await pronto;
  conectado = true;
  log("WhatsApp conectado como", client.info?.wid?.user ?? "?");
}

// Modo teste: manda uma mensagem e sai, sem subir a API.
const tel = argNumero("--teste");
if (tel) {
  const destino = await resolverDestino(tel);
  await client.sendMessage(destino, "Teste do worker da JMK MODAS: envio automático funcionando.");
  log("mensagem de teste enviada para", destino);
  await dormir(5_000);
  await client.destroy();
  process.exit(0);
}

if (!API_TOKEN) {
  log("AVISO: API_TOKEN vazio — a API aceita qualquer chamada. Preencha no .env antes de expor pelo túnel.");
}
limparMidiaVelha();
servidorApi.listen(PORTA_API, "127.0.0.1", () => {
  log(`API no ar em http://localhost:${PORTA_API} (emulando a do BubbleWhats).`);
  log("webhook atual:", config.receiveMessagesWebhook ? config.receiveMessagesWebhook.split("?")[0] : "(nenhum)");
  log("grupos:", config.receiveMessagesFromGroups ? "recebendo" : "ignorando");
});
