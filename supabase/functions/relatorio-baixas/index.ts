// Relatório diário das baixas por e-mail.
//
// O agendamento jmk-relatorio-baixas chama esta função às 07:00 (Brasília) com o
// cabeçalho x-report-secret; ela monta o relatório do DIA ANTERIOR (baixas
// automáticas e manuais, separadas, e os comprovantes que ficaram aguardando
// baixa manual) e envia pela caixa da Hostinger (SMTP, porta 465).
//
// Variáveis: SMTP_PASSWORD (obrigatória — senha da caixa), e opcionais SMTP_USER
// (padrão cido@jasprint.com.br), SMTP_HOST, SMTP_PORT, REPORT_EMAIL_TO
// (padrão ircido@gmail.com; vários separados por vírgula).
// Para reenviar um dia específico: POST com o mesmo cabeçalho e {"dia":"AAAA-MM-DD"}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getSecret, secretsMatch } from "../_shared/secrets.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Baixa = {
  hora: string; tipo: "automatica" | "manual"; comprovante: string; cliente: string; parcela: string;
  vencimento: string; valor: number; situacao_atual: string; pagador: string | null; data_pagamento: string | null;
};
type Aguardando = { hora: string; cliente: string; pagador: string | null; valor: number | null; motivo: string | null };

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Ontem no fuso de Brasília, como AAAA-MM-DD. */
function ontemBrasilia(): string {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  hoje.setDate(hoje.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(hoje.getDate())}`;
}

function montar(dia: string, baixas: Baixa[], aguardando: Aguardando[]) {
  const blocos = [
    { titulo: "Baixas automáticas (comprovante do WhatsApp)", itens: baixas.filter((b) => b.tipo === "automatica") },
    { titulo: "Baixas manuais (lançadas pela equipe)", itens: baixas.filter((b) => b.tipo === "manual") },
  ];
  const soma = (xs: Baixa[]) => xs.reduce((s, b) => s + Number(b.valor || 0), 0);
  const nComprov = (xs: Baixa[]) => new Set(xs.map((b) => b.comprovante)).size;
  const total = soma(baixas);

  const td = 'style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top"';
  const th = 'style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:left;background:#fafafa"';

  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 4px">Baixas de ${dataBR(dia)}</h2>
<p style="margin:0 0 16px;color:#555">Total baixado: <b>${brl(total)}</b> em ${nComprov(baixas)} pagamento(s), ${baixas.length} parcela(s).</p>`;
  let texto = `Baixas de ${dataBR(dia)}\nTotal baixado: ${brl(total)} em ${nComprov(baixas)} pagamento(s), ${baixas.length} parcela(s).\n`;

  for (const b of blocos) {
    html += `<h3 style="margin:20px 0 6px">${esc(b.titulo)} — ${brl(soma(b.itens))} (${nComprov(b.itens)} pagamento(s))</h3>`;
    texto += `\n${b.titulo} — ${brl(soma(b.itens))}\n`;
    if (b.itens.length === 0) {
      html += `<p style="color:#777;margin:0">Nenhuma.</p>`;
      texto += "  Nenhuma.\n";
      continue;
    }
    html += `<table style="border-collapse:collapse;width:100%"><tr>
<th ${th}>Hora</th><th ${th}>Cliente</th><th ${th}>Parcela</th><th ${th}>Venc.</th><th ${th}>Valor</th><th ${th}>Situação atual</th><th ${th}>Pagamento</th></tr>`;
    for (const x of b.itens) {
      const pag = [x.pagador, x.data_pagamento].filter(Boolean).join(" — ");
      html += `<tr><td ${td}>${esc(x.hora)}</td><td ${td}>${esc(x.cliente)}</td><td ${td}>${esc(x.parcela)}</td>
<td ${td}>${esc(x.vencimento)}</td><td ${td} align="right">${brl(x.valor)}</td><td ${td}>${esc(x.situacao_atual)}</td><td ${td}>${esc(pag)}</td></tr>`;
      texto += `  ${x.hora}  ${x.cliente} — ${x.parcela} (venc. ${x.vencimento}) — ${brl(x.valor)} — ${x.situacao_atual}${pag ? ` — ${pag}` : ""}\n`;
    }
    html += `</table>`;
  }

  html += `<h3 style="margin:20px 0 6px">Comprovantes que chegaram e aguardam baixa manual (${aguardando.length})</h3>`;
  texto += `\nComprovantes aguardando baixa manual (${aguardando.length})\n`;
  if (aguardando.length === 0) {
    html += `<p style="color:#777;margin:0">Nenhum.</p>`;
    texto += "  Nenhum.\n";
  } else {
    html += `<table style="border-collapse:collapse;width:100%"><tr><th ${th}>Hora</th><th ${th}>Cliente</th><th ${th}>Pagador</th><th ${th}>Valor</th><th ${th}>Motivo</th></tr>`;
    for (const a of aguardando) {
      html += `<tr><td ${td}>${esc(a.hora)}</td><td ${td}>${esc(a.cliente)}</td><td ${td}>${esc(a.pagador)}</td><td ${td} align="right">${brl(a.valor)}</td><td ${td}>${esc(a.motivo)}</td></tr>`;
      texto += `  ${a.hora}  ${a.cliente} — ${a.pagador ?? "?"} — ${brl(a.valor)} — ${a.motivo ?? ""}\n`;
    }
    html += `</table><p style="color:#555">Confira esses na tela Comprovantes do sistema.</p>`;
  }
  html += `<p style="color:#999;font-size:12px;margin-top:24px">"Situação atual" é a da parcela no momento do envio deste e-mail. Relatório automático do sistema JMK.</p></div>`;

  const assunto = `JMK — Baixas de ${dataBR(dia)}: ${brl(total)}`;
  return { assunto, html, texto };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const segredo = await getSecret("REPORT_SECRET", "report_secret");
  const enviado = req.headers.get("x-report-secret");
  if (!segredo || !enviado || !secretsMatch(enviado, segredo)) {
    return json({ error: "Não autorizado" }, 401);
  }

  let dia = ontemBrasilia();
  try {
    const body = await req.json();
    if (typeof body?.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dia)) dia = body.dia;
  } catch { /* corpo vazio: usa ontem */ }

  const senha = await getSecret("SMTP_PASSWORD", "smtp_password");
  if (!senha) return json({ error: "SMTP_PASSWORD não cadastrada — relatório não enviado" }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("relatorio_baixas_dia", { p_dia: dia });
  if (error) {
    console.error("relatorio_baixas_dia falhou:", error.message);
    return json({ error: error.message }, 500);
  }
  const baixas = ((data as any)?.baixas ?? []) as Baixa[];
  const aguardando = ((data as any)?.aguardando ?? []) as Aguardando[];
  const { assunto, html, texto } = montar(dia, baixas, aguardando);

  const usuario = Deno.env.get("SMTP_USER") ?? "cido@jasprint.com.br";
  const destinos = (Deno.env.get("REPORT_EMAIL_TO") ?? "ircido@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST") ?? "smtp.hostinger.com",
      port: Number(Deno.env.get("SMTP_PORT") ?? "465"),
      tls: true,
      auth: { username: usuario, password: senha },
    },
  });
  try {
    await client.send({ from: `Sistema JMK <${usuario}>`, to: destinos, subject: assunto, content: texto, html });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    console.error("envio do relatório falhou:", detalhe);
    return json({ error: `Falha no envio do e-mail: ${detalhe}` }, 502);
  } finally {
    try { await client.close(); } catch { /* já fechado */ }
  }

  console.log(`Relatório de ${dia} enviado para ${destinos.join(", ")}: ${baixas.length} baixa(s), ${aguardando.length} aguardando.`);
  return json({ ok: true, dia, baixas: baixas.length, aguardando: aguardando.length, para: destinos });
});
