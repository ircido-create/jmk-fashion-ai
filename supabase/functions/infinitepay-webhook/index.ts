// Aviso de pagamento da InfinitePay (loja virtual).
//
// O webhook deles NÃO é assinado: qualquer um que descubra a URL pode postar
// "pagou". Por isso aqui nada é dado como pago pelo que chegou no corpo. O
// aviso serve só de gatilho; a confirmação vem de uma consulta autenticada a
// POST /payment_check, com a chave da loja. É assim que a documentação oficial
// manda confirmar, e é o que protege o estoque de sair sem dinheiro entrar.
//
// A URL ainda carrega ?k=<store_payment_secret> para filtrar ruído antes de
// gastar uma consulta, mas isso é um filtro, não a prova.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSecret, secretsMatch } from "../_shared/secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHECK = "https://api.checkout.infinitepay.io/payment_check";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Filtro de porta: chave na query. Responde 200 para não virar sonda de
  // adivinhação, mas não processa nada.
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const segredo = await getSecret("STORE_PAYMENT_SECRET", "store_payment_secret");
  if (!segredo || !k || !secretsMatch(k, segredo)) {
    console.error("[infinitepay-webhook] chamada sem a chave da loja");
    return json({ ok: true });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }

  const orderNsu = String(corpo.order_nsu ?? "");
  const transactionNsu = String(corpo.transaction_nsu ?? "");
  const slug = String(corpo.invoice_slug ?? corpo.slug ?? "");
  const tipo = String(corpo.event ?? corpo.event_type ?? corpo.status ?? "paid");

  // Mesmo aviso reentregue não processa duas vezes: a chave única barra na porta.
  const eventKey = `${transactionNsu || slug || orderNsu}:${tipo}`;
  const { data: evento, error: erroEvento } = await admin
    .from("payment_webhook_events")
    .insert({ provider: "infinitepay", event_key: eventKey, event_type: tipo, payload: corpo })
    .select("id")
    .maybeSingle();

  if (erroEvento) {
    // 23505 = já existe: é reentrega, e a primeira já resolveu.
    if ((erroEvento as { code?: string }).code === "23505") return json({ ok: true, repetido: true });
    console.error("[infinitepay-webhook] não gravou o evento:", erroEvento.message);
    return json({ error: "erro ao registrar" }, 400);
  }

  const fecharEvento = async (status: string, erro?: string) => {
    await admin
      .from("payment_webhook_events")
      .update({ processing_status: status, error_message: erro ?? null, processed_at: new Date().toISOString() })
      .eq("id", evento!.id);
  };

  try {
    if (!orderNsu) {
      await fecharEvento("ignorado", "aviso sem order_nsu");
      return json({ ok: true });
    }

    const { data: charge } = await admin
      .from("payment_charges")
      .select("id, order_id, amount_cents, status, order_nsu, provider_slug")
      .eq("order_nsu", orderNsu)
      .maybeSingle();

    if (!charge) {
      await fecharEvento("ignorado", `cobrança ${orderNsu} não é desta loja`);
      return json({ ok: true });
    }

    // ---- a prova ----
    const apiKey = await getSecret("INFINITEPAY_API_KEY", "infinitepay_api_key");
    const handle = await getSecret("INFINITEPAY_HANDLE", "infinitepay_handle");

    let pago = false;
    let paidCents: number | null = null;
    let metodo: string | null = null;
    let parcelas: number | null = null;

    if (handle && transactionNsu) {
      const res = await fetch(CHECK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Api-Key": apiKey } : {}),
        },
        body: JSON.stringify({
          handle,
          order_nsu: orderNsu,
          transaction_nsu: transactionNsu,
          slug: slug || charge.provider_slug,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const texto = await res.text();
      let check: Record<string, unknown> = {};
      try {
        check = JSON.parse(texto);
      } catch {
        check = {};
      }
      // A API responde 200 com paid:false quando algo não bate. Só paid:true vale.
      pago = res.ok && check.success === true && check.paid === true;
      paidCents = typeof check.paid_amount === "number" ? check.paid_amount : null;
      metodo = (check.capture_method as string) ?? null;
      parcelas = typeof check.installments === "number" ? check.installments : null;

      if (!pago) {
        console.error(`[infinitepay-webhook] ${orderNsu}: payment_check não confirmou (${texto.slice(0, 200)})`);
      }
    } else {
      await fecharEvento("erro", "sem INFINITEPAY_HANDLE ou transaction_nsu para confirmar");
      return json({ ok: true, confirmado: false });
    }

    // Eventos que não são pagamento seguem para registro, sem tocar no financeiro.
    const statusFinal = pago ? (tipo === "settled" ? "settled" : "paid") : tipo;

    const { data: resultado, error: erroBaixa } = await admin.rpc("store_charge_settle", {
      p_charge_id: charge.id,
      p_transaction_nsu: transactionNsu,
      p_status: statusFinal,
      p_paid_cents: paidCents ?? charge.amount_cents,
      p_method: metodo,
      p_installments: parcelas,
      p_payload: corpo,
    });

    if (erroBaixa) {
      await fecharEvento("erro", erroBaixa.message);
      // 400 faz a InfinitePay reentregar — é o que queremos quando a falha é nossa.
      return json({ error: erroBaixa.message }, 400);
    }

    const situacao = (resultado as { situacao?: string } | null)?.situacao;
    if (situacao === "pago") {
      await avisarPagamento(admin, charge.order_id, paidCents ?? charge.amount_cents);
    }

    await fecharEvento("processado");
    return json({ ok: true, situacao });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "erro";
    console.error("[infinitepay-webhook]", detalhe);
    await fecharEvento("erro", detalhe);
    return json({ error: detalhe }, 400);
  }
});

/** Avisa a cliente e a loja de que o pagamento entrou. */
async function avisarPagamento(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  centavos: number,
) {
  const device = await getSecret("BUBBLEWHATS_DEVICE_ID", "bubblewhats_device_id");
  const token = await getSecret("BUBBLEWHATS_TOKEN", "bubblewhats_token");
  if (!device || !token) return;

  const { data: order } = await admin
    .from("store_orders")
    .select("code, customer_name, customer_phone")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const { data: cfg } = await admin
    .from("store_settings")
    .select("whatsapp, order_alert_whatsapp, order_confirm_customer")
    .maybeSingle();

  const primeiro = String(order.customer_name ?? "").split(" ")[0] ?? "";
  const nome = primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : "";

  const envios: Array<{ jid: string; msg: string; kind: string }> = [];

  if (cfg?.order_confirm_customer !== false) {
    const jid = String(order.customer_phone ?? "").replace(/\D/g, "");
    if (jid) {
      envios.push({
        jid,
        kind: "pagamento-confirmado",
        msg:
          `Pagamento confirmado, ${nome}! 💛\n` +
          `Pedido #${order.code} — ${brl(centavos)}\n\n` +
          `Já estamos separando suas peças. Qualquer dúvida, é só chamar aqui.`,
      });
    }
  }

  const loja = (cfg?.order_alert_whatsapp ?? cfg?.whatsapp ?? "").toString().trim();
  if (loja) {
    envios.push({
      jid: loja.includes("@g.us") ? loja : loja.replace(/\D/g, ""),
      kind: "pagamento-confirmado",
      msg:
        `💰 *Pagamento recebido na loja virtual*\n` +
        `Pedido #${order.code}\n` +
        `Cliente: ${order.customer_name}\n` +
        `Valor: ${brl(centavos)}\n\n` +
        `O pedido já virou venda no sistema.`,
    });
  }

  for (const e of envios) {
    try {
      const res = await fetch(`https://${device}.bubblewhats.com/send-message`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ jid: e.jid, message: e.msg }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await admin.from("store_order_alerts").insert({ order_id: orderId, kind: e.kind, destino: e.jid });
      } else {
        await admin.from("whatsapp_send_failures").insert({
          origem: "pagamento-loja",
          endpoint: "/send-message",
          destino: e.jid,
          http_status: res.status,
          detalhe: (await res.text()).slice(0, 500),
        });
      }
    } catch (err) {
      await admin.from("whatsapp_send_failures").insert({
        origem: "pagamento-loja",
        endpoint: "/send-message",
        destino: e.jid,
        http_status: 0,
        detalhe: err instanceof Error ? err.message.slice(0, 500) : "erro de rede",
      });
    }
  }
}
