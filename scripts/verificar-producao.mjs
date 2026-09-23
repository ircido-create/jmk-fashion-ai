#!/usr/bin/env node
// Confere as edge functions em produção contra o repositório.
//
//   npm run verificar:producao
//
// 1) Toda pasta em supabase/functions precisa estar publicada (OPTIONS ≠ 404).
// 2) Funções internas precisam recusar chamada sem login (401/403). Em 23/09/2026
//    ai-assistant, scan-label, parse-receivables-pdf e associate-romaneio-photos
//    respondiam a qualquer um — a IA era usada nos créditos da loja.
//
// Não chama dunning-cron nem bubblewhats-webhook com POST: a cobrança registra
// toda chamada recusada como rodada com falha e o painel acusaria um alarme falso.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const toml = readFileSync("supabase/config.toml", "utf8");
const projectId = toml.match(/project_id\s*=\s*"([^"]+)"/)?.[1];
if (!projectId) {
  console.error("project_id não encontrado em supabase/config.toml");
  process.exit(2);
}
const base = `https://${projectId}.supabase.co/functions/v1`;

// Públicas de propósito, ou protegidas por segredo próprio (não testar sem login).
const PUBLICAS = new Set(["bubblewhats-webhook", "dunning-cron", "store-try-on"]);

const funcoes = readdirSync("supabase/functions", { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .sort();

const problemas = [];

for (const nome of funcoes) {
  const url = `${base}/${nome}`;
  let linha = nome.padEnd(30);

  const opt = await fetch(url, { method: "OPTIONS" }).catch((e) => ({ status: 0, text: async () => String(e) }));
  if (opt.status === 404 || opt.status === 0) {
    linha += "NÃO PUBLICADA";
    problemas.push(`${nome}: não está publicada (existe só no repositório)`);
    console.log(linha);
    continue;
  }
  linha += "publicada";

  if (PUBLICAS.has(nome)) {
    console.log(`${linha} · pública/segredo próprio (não testada sem login)`);
    continue;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch((e) => ({ status: 0, text: async () => String(e) }));
  if (res.status === 401 || res.status === 403) {
    console.log(`${linha} · recusa sem login (${res.status})`);
  } else {
    const corpo = (await res.text()).slice(0, 80).replace(/\s+/g, " ");
    console.log(`${linha} · RESPONDE SEM LOGIN (${res.status}: ${corpo})`);
    problemas.push(`${nome}: responde sem login (HTTP ${res.status}) — versão publicada sem checagem de acesso`);
  }
}

console.log("");
if (problemas.length === 0) {
  console.log(`OK: ${funcoes.length} funções publicadas e protegidas.`);
} else {
  console.log(`${problemas.length} problema(s):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exitCode = 1;
}
