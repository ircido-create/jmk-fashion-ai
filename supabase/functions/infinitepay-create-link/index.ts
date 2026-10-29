// Link de pagamento do pedido da loja virtual (InfinitePay) + envio pelo WhatsApp.
//
// Quem chama: o gatilho do banco, assim que o pedido fecha (cabeçalho com o
// segredo), ou a equipe pelo painel (JWT de admin), quando quer gerar de novo.
//
// A função é a única que conhece a chave da InfinitePay. O valor NUNCA vem de
// quem chamou: ela lê a cobrança do banco, que por sua vez copiou o total do
// pedido. Assim um pedido não pode ser pago por R$ 1,00 porque alguém mexeu no
// corpo da requisição.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSecret, secretsMatch } from "../_shared/secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-store-payment-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const API = "https://api.checkout.infinitepay.io/links";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Nega por padrão: a função cria cobrança de verdade. */
async function autorizado(req: Request): Promise<boolean> {
  const segredo = await getSecret("STORE_PAYMENT_SECRET", "store_payment_secret");
  const enviado = req.headers.get("x-store-payment-secret");
  if (segredo && enviado && secretsMatch(enviado, segredo)) return true;

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await client.auth.getUser();
    if (!userData?.user) return false;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    return (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "vendedor");
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await autorizado(req))) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { order_id, enviar_whatsapp = true } = await req.json();
    if (!order_id) return json({ error: "order_id obrigatório" }, 400);

    // 1) Cobrança do pedido (idempotente: a mesma compra nunca gera duas).
    const { data: charge, error: erroCharge } = await admin.rpc("store_charge_open", {
      p_order_id: order_id,
    });
    if (erroCharge) return json({ error: erroCharge.message }, 400);
    if (!charge) return json({ error: "Cobrança não encontrada" }, 404);

    if (charge.status === "pago") {
      return json({ ok: true, ja_pago: true, charge_id: charge.id });
    }

    const { data: order } = await admin
      .from("store_orders")
      .select("code, customer_name, customer_phone, customer_email, total")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) return json({ error: "Pedido não encontrado" }, 404);

    // 2) Link já válido: reaproveita em vez de criar outro na InfinitePay.
    const aindaVale =
      charge.link_url &&
      charge.status === "aguardando" &&
      (!charge.link_expires_at || new Date(charge.link_expires_at) > new Date());

    let link: string | null = aindaVale ? charge.link_url : null;
    let slug: string | null = aindaVale ? charge.provider_slug : null;

    if (!link) {
      const apiKey = await getSecret("INFINITEPAY_API_KEY", "infinitepay_api_key");
      const handle = await getSecret("INFINITEPAY_HANDLE", "infinitepay_handle");
      if (!apiKey && !handle) {
        await admin.rpc("store_charge_set_link", {
          p_charge_id: charge.id,
          p_url: null,
          p_error: "InfinitePay não configurada (INFINITEPAY_API_KEY / INFINITEPAY_HANDLE)",
        });
        return json({ error: "InfinitePay não configurada" }, 503);
      }

      const publicUrl = Deno.env.get("APP_PUBLIC_URL") ?? "https://www.jmkmodas.com.br";
      const webhookSecret = await getSecret("STORE_PAYMENT_SECRET", "store_payment_secret");

      // Só os campos que a documentação oficial descreve. `options` exige API Key:
      // sem ela o link sai sem validade e sem trava de pagamento único.
      const payload: Record<string, unknown> = {
        order_nsu: charge.order_nsu,
        items: [
          {
            quantity: 1,
            price: charge.amount_cents,
            description: charge.description,
          },
        ],
        redirect_url: `${publicUrl}/loja/pedido/${order.code}`,
        webhook: {
          url: `${SUPABASE_URL}/functions/v1/infinitepay-webhook?k=${webhookSecret ?? ""}`,
          events: ["paid", "settled", "canceled", "refunded", "payment_failed"],
        },
        customer: {
          name: order.customer_name,
          phone_number: `+${String(order.customer_phone).replace(/\D/g, "")}`,
          ...(order.customer_email ? { email: order.customer_email } : {}),
        },
      };
      if (handle) payload.handle = handle;
      if (apiKey) {
        payload.options = {
          single_payment: true,
          valid_until: charge.link_expires_at,
          payment_methods_enabled: ["credit_card", "pix"],
        };
      }

      const res = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Api-Key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const texto = await res.text();
      if (!res.ok) {
        const detalhe = `HTTP ${res.status}: ${texto.slice(0, 300)}`;
        console.error("[infinitepay] falha ao criar link:", detalhe);
        await admin.rpc("store_charge_set_link", {
          p_charge_id: charge.id,
          p_url: null,
          p_error: detalhe,
        });
        return json({ error: "Não foi possível gerar o link agora.", detalhe }, 502);
      }

      // O nome do campo da URL não está documentado: aceita os que a API usa,
      // e nunca monta uma URL por conta própria.
      let corpo: Record<string, unknown> = {};
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = {};
      }
      const dados = (corpo.data ?? corpo) as Record<string, unknown>;
      link = (dados.url ?? dados.link ?? dados.checkout_url ?? dados.payment_url ?? null) as string | null;
      slug = (dados.slug ?? dados.invoice_slug ?? null) as string | null;

      if (!link) {
        const detalhe = `Resposta sem URL: ${texto.slice(0, 300)}`;
        console.error("[infinitepay]", detalhe);
        await admin.rpc("store_charge_set_link", { p_charge_id: charge.id, p_url: null, p_error: detalhe });
        return json({ error: "A InfinitePay não devolveu o link.", detalhe }, 502);
      }

      const { error: erroLink } = await admin.rpc("store_charge_set_link", {
        p_charge_id: charge.id,
        p_url: link,
        p_slug: slug,
        p_expires: charge.link_expires_at,
      });
      if (erroLink) return json({ error: erroLink.message }, 500);
    }

    // 3) Mensagem para a cliente, com a confirmação do pedido e o link.
    let enviado = false;
    if (enviar_whatsapp) {
      enviado = await mandarWhatsApp(admin, {
        order_id,
        code: order.code,
        nome: String(order.customer_name ?? ""),
        telefone: String(order.customer_phone ?? ""),
        valor: charge.amount_cents,
        link,
      });
    }

    return json({ ok: true, charge_id: charge.id, link, slug, whatsapp: enviado });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "erro";
    console.error("[infinitepay-create-link]", detalhe);
    return json({ error: detalhe }, 500);
  }
});

async function mandarWhatsApp(
  admin: ReturnType<typeof createClient>,
  p: { order_id: string; code: string; nome: string; telefone: string; valor: number; link: string },
): Promise<boolean> {
  const device = await getSecret("BUBBLEWHATS_DEVICE_ID", "bubblewhats_device_id");
  const token = await getSecret("BUBBLEWHATS_TOKEN", "bubblewhats_token");
  const jid = p.telefone.replace(/\D/g, "");
  if (!device || !token || !jid) return false;

  const primeiro = p.nome.split(" ")[0] ?? "";
  const nome = primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const msg =
    `Olá, ${nome}! Recebemos seu pedido na *JMK Modas* 💛\n` +
    `Pedido #${p.code}\n\n` +
    `Total: ${brl(p.valor)}\n\n` +
    `Você já pode pagar por Pix ou cartão por aqui:\n${p.link}\n\n` +
    `Assim que o pagamento entrar, suas peças saem para você. ` +
    `Se preferir combinar de outro jeito, é só me chamar.`;

  try {
    const res = await fetch(`https://${device}.bubblewhats.com/send-message`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ jid, message: msg }),
      signal: AbortSignal.timeout(10_000),
    });
    const texto = await res.text();
    if (!res.ok) {
      await admin.from("whatsapp_send_failures").insert({
        origem: "pagamento-loja",
        endpoint: "/send-message",
        destino: jid,
        http_status: res.status,
        detalhe: texto.slice(0, 500),
      });
      return false;
    }
    await admin.from("store_order_alerts").insert({
      order_id: p.order_id,
      kind: "link-pagamento",
      destino: jid,
    });
    return true;
  } catch (e) {
    await admin.from("whatsapp_send_failures").insert({
      origem: "pagamento-loja",
      endpoint: "/send-message",
      destino: jid,
      http_status: 0,
      detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro de rede",
    });
    return false;
  }
}
