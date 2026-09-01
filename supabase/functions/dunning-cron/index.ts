// Cobrança automática diária via BubbleWhats
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dunning-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Compara sem vazar pelo tempo de resposta onde as strings divergem. */
function secretsMatch(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * A função dispara mensagens reais para clientes e roda com verify_jwt = false,
 * então precisa autorizar por conta própria. Aceita dois chamadores: o agendamento
 * (segredo no cabeçalho) e o botão do painel (JWT de admin).
 *
 * Nega por padrão. Antes, sem DUNNING_SECRET definido ela retornava true e o
 * endpoint ficava aberto para qualquer um disparar a cobrança da loja inteira.
 *
 * Devolve null quando autorizado, ou o motivo da recusa.
 */
async function motivoRecusa(req: Request): Promise<string | null> {
  const segredo = Deno.env.get("DUNNING_SECRET");
  if (!segredo) {
    return "DUNNING_SECRET não configurado nas variáveis da edge function — a cobrança automática está parada até o segredo ser definido.";
  }

  const enviado = req.headers.get("x-dunning-secret");
  if (enviado && secretsMatch(enviado, segredo)) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return enviado
      ? "Segredo inválido na chamada da cobrança automática."
      : "Chamada sem credencial — verifique se o agendamento envia o cabeçalho x-dunning-secret.";
  }
  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData?.user) return "Sessão inválida.";
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    return isAdmin ? null : "Apenas administradores podem disparar a cobrança.";
  } catch {
    return "Falha ao validar a credencial.";
  }
}

/**
 * Registra a recusa como rodada falha para o painel mostrar a interrupção — um
 * 401 silencioso pararia a cobrança sem ninguém perceber, que é exatamente o
 * problema que dunning_runs existe para evitar. Deduplicado por hora, para que
 * varredura na URL não encha a tabela.
 */
async function registrarRecusa(motivo: string) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const umaHoraAtras = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supabase
      .from("dunning_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "falha")
      .eq("erro", motivo)
      .gte("started_at", umaHoraAtras);
    if ((count ?? 0) > 0) return;

    await supabase.from("dunning_runs").insert({
      origem: "cron",
      status: "falha",
      erro: motivo,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("falha ao registrar recusa da cobrança:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const recusa = await motivoRecusa(req);
  if (recusa) {
    console.warn("cobrança recusada:", recusa);
    await registrarRecusa(recusa);
    return json({ error: "Não autorizado" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const origem = req.headers.get("x-dunning-secret") ? "cron" : "manual";

  // Abre o registro antes do trabalho: se a rodada morrer no meio, a linha fica
  // como 'executando' e denuncia a interrupção.
  const { data: run } = await supabase
    .from("dunning_runs")
    .insert({ origem })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  const fecharRun = async (campos: Record<string, unknown>) => {
    if (!runId) return;
    await supabase
      .from("dunning_runs")
      .update({ finished_at: new Date().toISOString(), ...campos })
      .eq("id", runId);
  };

  try {
    const deviceId = Deno.env.get("BUBBLEWHATS_DEVICE_ID");
    const bwToken = Deno.env.get("BUBBLEWHATS_TOKEN");
    if (!deviceId || !bwToken) {
      await fecharRun({ status: "falha", erro: "BubbleWhats não configurado" });
      return json({ skipped: "BubbleWhats não configurado" });
    }

    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).toISOString().slice(0, 10);
    await supabase
      .from("accounts_receivable")
      .update({ status: "vencido" })
      .lt("due_date", today)
      .eq("status", "pendente");

    // Lembretes: títulos que vencem HOJE (ainda pendentes) recebem um aviso amigável
    // antes de virarem cobrança de atraso.
    const { data: dueToday, error: erroHoje } = await supabase
      .rpc("get_due_today_receivables_to_dunning", { p_today: today, p_limit: 50 });

    if (erroHoje) {
      console.error("Falha ao buscar vencimentos de hoje:", erroHoje.message);
    }

    // 3. Busca débitos vencidos (status 'vencido') que possuem cliente com telefone
    // Filtramos para ignorar os que já foram cobrados hoje via dunning_logs
    const { data: overdue, error: erroBusca } = await supabase
      .rpc('get_overdue_receivables_to_dunning', {
        p_today: today,
        p_limit: 60,
        p_max_dias_vencido: 180
      });

    // O erro desta chamada era descartado. Se a RPC não existir no banco, overdue
    // vem nulo, o laço não roda e a rodada termina "com sucesso" tendo enviado
    // zero — nenhuma cobrança sai e nada denuncia o motivo.
    if (erroBusca) {
      const detalhe = `Falha ao buscar vencidos (RPC get_overdue_receivables_to_dunning): ${erroBusca.message}`;
      console.error(detalhe);
      await fecharRun({ status: "falha", erro: detalhe });
      return json({ error: detalhe }, 500);
    }

    const total = (overdue?.length ?? 0) + (dueToday?.length ?? 0);
    let sent = 0;
    let reminders = 0;
    let failed = 0;
    let skippedAlreadySent = 0;
    let skippedBlocked = 0;
    let skippedOld = 0;
    const erros: string[] = [];
    const url = `https://${deviceId}.bubblewhats.com/send-message`;

    const dataBR = (d: unknown) => {
      const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
    };

    const mensagemLembrete = (nome: string, r: any) =>
      `Bom dia, ${nome} 💕 Aqui é da JMK! Passando só para lembrar com carinho que sua parcela de R$ ${r.amount} (${r.description ?? "sua comprinha"}) vence hoje (${dataBR(r.due_date)}). Se precisar do Pix ou de qualquer ajuda, é só me chamar. Que Deus te abençoe! 🌸\n\n👉🏻 Se já pagou, desconsidere este lembrete!`;

    const mensagemCobranca = (nome: string, r: any) =>
      `Olá, ${nome} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} (${r.description ?? "sua comprinha"}) que venceu em ${dataBR(r.due_date)}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸\n\n👉🏻 Caso tenha efetuado o pagamento, desconsidere este lembrete!`;

    const processar = async (
      lista: any[],
      tipo: "lembrete" | "cobranca",
    ) => {
      for (const r of lista) {
        const cust: any = (r as any).customers;
        const phone = String(cust?.phone || "").replace(/\D/g, "");
        if (!phone) continue;

        // Regra Anti-Spam: não envia se o título venceu há muito tempo
        // (evita spam de dívidas legadas). Só se aplica à cobrança.
        if (tipo === "cobranca") {
          const daysOverdue = Math.floor((new Date(today).getTime() - new Date(r.due_date).getTime()) / 86400000);
          if (daysOverdue > 180) {
            skippedOld++;
            continue;
          }
        }

        // Não envia se já houve mensagem para ESTE título HOJE
        const { count } = await supabase
          .from("dunning_logs")
          .select("*", { count: "exact", head: true })
          .eq("receivable_id", r.id)
          .gte("sent_at", new Date(today).toISOString());

        if ((count ?? 0) > 0) {
          skippedAlreadySent++;
          continue;
        }

        // Verifica se o contato está na White List (Silêncio)
        const { data: isBlocked } = await supabase
          .from("ai_blocked_contacts")
          .select("id")
          .eq("phone", phone)
          .maybeSingle();
        if (isBlocked) {
          skippedBlocked++;
          continue;
        }

        const msg = tipo === "lembrete"
          ? mensagemLembrete(cust.name, r)
          : mensagemCobranca(cust.name, r);

        const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: bwToken, "Content-Type": "application/json" },
            body: JSON.stringify({ jid, message: msg }),
            // Sem timeout, um envio pendurado trava a rodada inteira até o limite da
            // edge function, e os clientes seguintes da fila não são cobrados.
            signal: AbortSignal.timeout(20000),
          });

          if (res.ok) {
            await supabase.from("dunning_logs").insert({
              customer_id: r.customer_id,
              receivable_id: r.id,
              message: msg,
              sent_at: new Date().toISOString()
            });

            // CRITICAL: Salva também em whatsapp_messages para aparecer na aba de conversas
            const { data: conv } = await supabase
              .from("whatsapp_conversations")
              .select("id")
              .eq("customer_phone", phone)
              .maybeSingle();

            if (conv) {
              await supabase.from("whatsapp_messages").insert({
                conversation_id: conv.id,
                direction: "outbound",
                content: msg,
                sent_at: new Date().toISOString()
              });
            }

            if (tipo === "lembrete") reminders++; else sent++;
          } else {
            failed++;
            const errText = (await res.text()).slice(0, 200);
            console.error(`Falha envio BubbleWhats (${phone}):`, res.status, errText);
            if (erros.length < 5) erros.push(`${phone}: HTTP ${res.status} ${errText}`);
          }
        } catch (fetchErr) {
          failed++;
          const detalhe = fetchErr instanceof Error ? fetchErr.message : "erro de rede";
          console.error(`Erro de rede ao enviar para ${phone}:`, detalhe);
          if (erros.length < 5) erros.push(`${phone}: ${detalhe}`);
        }

        // Pequeno delay para não sobrecarregar a API/WhatsApp
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    };

    await processar(dueToday ?? [], "lembrete");
    await processar(overdue ?? [], "cobranca");

    // Falha de envio ia para whatsapp_config.last_error_message, campo que descreve
    // o estado da sessão do WhatsApp e das respostas da IA. Misturar cobrança ali
    // fazia o painel acusar problema de conexão quando o que falhou foi um envio.
    // O lugar do resultado da cobrança é dunning_runs, que o painel exibe.
    await fecharRun({
      status: "sucesso",
      total,
      enviadas: sent + reminders,
      falhadas: failed,
      erro: erros.length ? erros.join(" | ") : null,
    });

    console.log(`Resumo: ${reminders} lembretes (vencem hoje), ${sent} cobranças (vencidas), ${failed} falhas, ${total} analisados.`);
    console.log(`Skips: ${skippedAlreadySent} já enviados hoje, ${skippedBlocked} bloqueados, ${skippedOld} dívidas antigas.`);

    return json({ reminders, sent, failed, total_processed: total, skipped: { already_sent: skippedAlreadySent, blocked: skippedBlocked, old: skippedOld } });

  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "Erro";
    console.error(detalhe);
    await fecharRun({ status: "falha", erro: detalhe });
    return json({ error: detalhe }, 500);
  }
});
