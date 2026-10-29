import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Check, CreditCard, MessageCircle } from "lucide-react";
import { fmtBRL } from "@/lib/utils";
import { useStore } from "../StoreContext";
import { fetchOrderPayment, type OrderPayment } from "../api";
import { displayName, onlyDigits, variantLabel, type OrderSnapshot } from "../types";

function readSnapshot(code?: string): OrderSnapshot | null {
  if (!code) return null;
  try {
    const raw = sessionStorage.getItem(`jmk_store_order_${code}`);
    return raw ? (JSON.parse(raw) as OrderSnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Confirmação do pedido. Não consulta o banco de propósito: o código é curto e
 * uma busca pública por ele exporia nome e endereço de quem o adivinhasse. O
 * resumo vem do próprio aparelho que fez o pedido.
 */
export default function StoreOrderDone() {
  const { code } = useParams();
  const { settings } = useStore();
  const snap = useMemo(() => readSnapshot(code), [code]);

  // O link de pagamento é criado logo depois do pedido, fora desta tela: ela
  // consulta, e volta a consultar algumas vezes enquanto ainda não chegou.
  const [pagamento, setPagamento] = useState<OrderPayment | null>(null);
  useEffect(() => {
    if (!code) return;
    let vivo = true;
    let tentativas = 0;
    const consultar = async () => {
      const p = await fetchOrderPayment(code);
      if (!vivo) return;
      if (p) setPagamento(p);
      tentativas += 1;
      if (!p?.link_url && p?.status !== "pago" && tentativas < 6) {
        setTimeout(consultar, 2500);
      }
    };
    consultar();
    return () => { vivo = false; };
  }, [code]);

  const whatsapp = settings?.whatsapp ? onlyDigits(settings.whatsapp) : "";
  const message = useMemo(() => {
    const lines = snap?.lines.map((l) => {
      const v = variantLabel(l);
      return `• ${l.quantity}x ${displayName(l.name)}${v ? ` (${v})` : ""}`;
    }) ?? [];
    return [
      `Olá! Acabei de fazer o pedido #${code} na loja virtual.`,
      ...lines,
      snap ? `Total: ${fmtBRL(snap.total)}` : "",
      snap ? (snap.delivery_method === "entrega" ? "Quero receber em casa." : "Vou retirar na loja.") : "",
    ].filter(Boolean).join("\n");
  }, [code, snap]);

  const firstName = snap?.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#ecd3a2] to-[#d8bd8a] shadow-[0_0_60px_-10px_rgba(216,189,138,0.8)] s-fade-up">
        <Check className="h-8 w-8 text-[#17130c]" />
      </div>
      <p className="s-eyebrow mt-8">Pedido #{code}</p>
      <h1 className="s-display mt-3 text-5xl">
        {firstName ? `Recebemos seu pedido, ${displayName(firstName)}!` : "Recebemos seu pedido!"}
      </h1>
      <p className="mx-auto mt-5 max-w-lg leading-relaxed s-muted">
        Suas peças já estão reservadas. Nossa equipe vai chamar você no WhatsApp para combinar o pagamento
        {snap?.delivery_method === "entrega" ? " e o frete" : " e a retirada"}.
      </p>

      {snap && (
        <div className="s-card mt-10 p-6 text-left">
          <ul className="space-y-3">
            {snap.lines.map((l) => (
              <li key={`${l.productId}:${l.variantId}`} className="flex items-center gap-4">
                <img src={l.image} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{displayName(l.name)}</p>
                  <p className="text-xs s-muted">
                    {l.quantity}x{variantLabel(l) ? ` · ${variantLabel(l)}` : ""}
                  </p>
                </div>
                <span className="text-sm tabular-nums s-gold">{fmtBRL(l.price * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-baseline justify-between border-t pt-4 s-divider">
            <span className="s-muted">Total das peças</span>
            <span className="text-xl font-semibold tabular-nums s-gold">{fmtBRL(snap.total)}</span>
          </div>
        </div>
      )}

      {pagamento?.status === "pago" ? (
        <p className="s-card mt-8 px-6 py-5 text-sm s-gold">
          <Check className="mr-2 inline h-4 w-4" /> Pagamento confirmado. Já estamos separando suas peças.
        </p>
      ) : pagamento?.link_url ? (
        <div className="s-card mt-8 px-6 py-6">
          <p className="s-eyebrow">Pagamento</p>
          <p className="mt-2 text-sm s-muted">
            Você pode pagar agora por Pix ou cartão. Se preferir, combine com a loja pelo WhatsApp.
          </p>
          <a href={pagamento.link_url} target="_blank" rel="noreferrer" className="s-btn s-btn-gold mt-5 w-full">
            <CreditCard /> Pagar agora
          </a>
        </div>
      ) : null}

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="s-btn s-btn-gold"
          >
            <MessageCircle /> Falar com a loja no WhatsApp
          </a>
        )}
        <Link to="/loja" className="s-btn s-btn-ghost">
          Continuar comprando <ArrowRight />
        </Link>
      </div>
    </div>
  );
}
