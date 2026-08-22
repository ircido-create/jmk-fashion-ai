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

/**
 * A função dispara mensagens reais para clientes e roda com verify_jwt = false,
 * então precisa autorizar por conta própria. Aceita dois chamadores: o agendamento
 * (segredo no cabeçalho) e o botão do painel (JWT de admin).
 *
 * Enquanto DUNNING_SECRET não estiver definido, segue aberta como antes — exigir o
 * segredo já no deploy derrubaria a cobrança agendada antes de o cron ser
 * atualizado para enviá-lo.
 */
async function autorizado(req: Request): Promise<boolean> {
  const segredo = Deno.env.get("DUNNING_SECRET");
  if (!segredo) {
    console.warn("DUNNING_SECRET não definido — endpoint aberto. Defina o segredo e atualize o cron.");
    return true;
  }

  if (req.headers.get("x-dunning-secret") === segredo) return true;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData?.user) return false;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    return !!isAdmin;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await autorizado(req))) return json({ error: "Não autorizado" }, 401);

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

    // 3. Busca débitos vencidos (status 'vencido') que possuem cliente com telefone
    // Filtramos para ignorar os que já foram cobrados hoje via dunning_logs
    const { data: overdue, error: erroBusca } = await supabase
      .rpc('get_overdue_receivables_to_dunning', {
        p_today: today,
        // 50 títulos com pausa entre envios estouravam o limite de 150s da edge
        // function: a rodada morria sem gravar o resultado. 20 cabem com folga.
        p_limit: 20
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

    const total = overdue?.length ?? 0;
    let sent = 0;
    let failed = 0;
    let skippedAlreadySent = 0;
    let skippedBlocked = 0;
    let skippedOld = 0;
    const erros: string[] = [];
    const url = `https://${deviceId}.bubblewhats.com/send-message`;

    for (const r of overdue ?? []) {
      const cust: any = (r as any).customers;
      const phone = String(cust?.phone || "").replace(/\D/g, "");
      if (!phone) continue;

      // 4. Regra Anti-Spam: Não envia se já houve cobrança para ESTE título HOJE
      // E também não envia se o título venceu há muito tempo (evita spam de dívidas legadas)
      // 4. Regra Anti-Spam: Não envia se já houve cobrança para ESTE título HOJE
      // E também não envia se o título venceu há muito tempo (evita spam de dívidas legadas)
      const daysOverdue = Math.floor((new Date(today).getTime() - new Date(r.due_date).getTime()) / 86400000);
      if (daysOverdue > 60) {
        skippedOld++;
        continue;
      }

      const { count } = await supabase
        .from("dunning_logs")
        .select("*", { count: "exact", head: true })
        .eq("receivable_id", r.id)
        .gte("sent_at", new Date(today).toISOString());

      if ((count ?? 0) > 0) {
        skippedAlreadySent++;
        continue;
      }

      // 5. Verifica se o contato está na White List (Silêncio)
      const { data: isBlocked } = await supabase
        .from("ai_blocked_contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (isBlocked) {
        skippedBlocked++;
        continue;
      }

      const dueBR = (() => {
        const m = String(r.due_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(r.due_date);
      })();

      const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} (${r.description ?? "sua comprinha"}) que venceu em ${dueBR}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸\n\n👉🏻 Caso tenha efetuado o pagamento, desconsidere este lembrete!`;

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
          // Salva no log de cobrança para controle interno
          await supabase.from("dunning_logs").insert({
            customer_id: r.customer_id,
            receivable_id: r.id,
            message: msg,
            sent_at: new Date().toISOString()
          });
          
          // CRITICAL: Salva também em whatsapp_messages para aparecer na aba de conversas
          // e para que possamos auditar se a mensagem realmente "saiu" do sistema.
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

          sent++;
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

    // Falha de envio ia para whatsapp_config.last_error_message, campo que descreve
    // o estado da sessão do WhatsApp e das respostas da IA. Misturar cobrança ali
    // fazia o painel acusar problema de conexão quando o que falhou foi um envio.
    // O lugar do resultado da cobrança é dunning_runs, que o painel exibe.
    await fecharRun({
      status: "sucesso",
      total,
      enviadas: sent,
      falhadas: failed,
      erro: erros.length ? erros.join(" | ") : null,
      // Armazenamos detalhes do skip no log da edge function para auditoria
    });

    console.log(`Resumo: ${sent} enviadas, ${failed} falhas, ${total} analisados.`);
    console.log(`Skips: ${skippedAlreadySent} já enviados hoje, ${skippedBlocked} bloqueados, ${skippedOld} dívidas antigas.`);

    return json({ sent, failed, total_processed: total, skipped: { already_sent: skippedAlreadySent, blocked: skippedBlocked, old: skippedOld } });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "Erro";
    console.error(detalhe);
    await fecharRun({ status: "falha", erro: detalhe });
    return json({ error: detalhe }, 500);
  }
});
