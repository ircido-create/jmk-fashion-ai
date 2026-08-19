import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // 1. Get Ruth's phone
  const { data: cust } = await supabase.from("customers").select("id, name, phone").ilike("name", "%RUTH DA SILVA LUCAS PINTO%").maybeSingle();
  if (!cust) return new Response("Customer not found", { status: 404 });

  // 2. Get overdue debt
  const today = new Date().toISOString().slice(0, 10);
  const { data: overdue } = await supabase.from("accounts_receivable")
    .select("*")
    .eq("customer_id", cust.id)
    .eq("status", "vencido")
    .lt("due_date", today)
    .maybeSingle();
    
  if (!overdue) return new Response("No overdue debt found for Ruth", { status: 404 });

  // 3. Compose message
  const dueBR = (() => {
    const m = String(overdue.due_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(overdue.due_date);
  })();
  const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${overdue.amount} (${overdue.description ?? "sua comprinha"}) que venceu em ${dueBR}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸\n\n👉🏻 Caso tenha efetuado o pagamento, desconsidere este lembrete!`;

  // 4. Send message
  const jid = String(cust.phone).replace(/\D/g, "");
  const url = `https://${DEVICE_ID}.bubblewhats.com/send-message`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: BW_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ jid, message: msg }),
  });

  const resText = await res.text();
  if (res.ok) {
    await supabase.from("dunning_logs").insert({
      customer_id: cust.id,
      receivable_id: overdue.id,
      message: msg,
    });
    return new Response(JSON.stringify({ ok: true, message: "Dunning sent manually for Ruth", bw: resText }), { headers: { "Content-Type": "application/json" } });
  } else {
    return new Response(JSON.stringify({ ok: false, error: resText, status: res.status }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
