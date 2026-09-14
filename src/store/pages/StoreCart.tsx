import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Minus, Plus, ShoppingBag, Store, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/utils";
import { useStore } from "../StoreContext";
import { placeOrder } from "../api";
import {
  displayName, lineKey, onlyDigits, variantLabel,
  type DeliveryMethod, type OrderInput, type OrderSnapshot,
} from "../types";

const CUSTOMER_KEY = "jmk_store_customer_v1";

type Form = {
  name: string; phone: string; email: string; delivery: DeliveryMethod;
  cep: string; street: string; number: string; complement: string;
  neighborhood: string; city: string; state: string; notes: string;
};

const EMPTY: Form = {
  name: "", phone: "", email: "", delivery: "retirada",
  cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", notes: "",
};

/** (11) 98765-4321 enquanto digita. */
function maskPhone(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function readSaved(): Partial<Form> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function StoreCart() {
  const { cart, cartTotal, setLineQty, removeLine, clearCart, reload, settings } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => ({ ...EMPTY, ...readSaved() }));
  const [sending, setSending] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // CEP completo preenche o endereço pelo ViaCEP. Falhou? A cliente digita.
  const cepDigits = onlyDigits(form.cep);
  useEffect(() => {
    if (form.delivery !== "entrega" || cepDigits.length !== 8) return;
    let cancelled = false;
    setCepLoading(true);
    fetch(`https://viacep.com.br/ws/${cepDigits}/json/`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || d?.erro) return;
        setForm((f) => ({
          ...f,
          street: d.logradouro || f.street,
          neighborhood: d.bairro || f.neighborhood,
          city: d.localidade || f.city,
          state: d.uf || f.state,
        }));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setCepLoading(false); });
    return () => { cancelled = true; };
  }, [cepDigits, form.delivery]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    const phone = onlyDigits(form.phone);
    if (form.name.trim().length < 2) return toast.error("Informe seu nome");
    if (phone.length < 10) return toast.error("Informe seu WhatsApp com DDD");
    if (form.delivery === "entrega" && (cepDigits.length !== 8 || !form.street.trim() || !form.number.trim() || !form.city.trim())) {
      return toast.error("Preencha o endereço de entrega");
    }

    const order: OrderInput = {
      name: form.name.trim(),
      phone,
      email: form.email.trim() || undefined,
      delivery_method: form.delivery,
      notes: form.notes.trim() || undefined,
      address:
        form.delivery === "entrega"
          ? {
              cep: cepDigits,
              street: form.street.trim(),
              number: form.number.trim(),
              complement: form.complement.trim() || undefined,
              neighborhood: form.neighborhood.trim() || undefined,
              city: form.city.trim(),
              state: form.state.trim().toUpperCase().slice(0, 2),
            }
          : undefined,
    };

    setSending(true);
    try {
      const { code, total } = await placeOrder(order, cart);
      const snapshot: OrderSnapshot = { code, total, name: order.name, delivery_method: order.delivery_method, lines: cart };
      try {
        sessionStorage.setItem(`jmk_store_order_${code}`, JSON.stringify(snapshot));
        // Lembra nome/telefone/endereço para a próxima compra neste aparelho.
        const { notes: _notes, ...keep } = form;
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(keep));
      } catch {
        // sem storage: a confirmação mostra só o código
      }
      clearCart();
      navigate(`/loja/pedido/${code}`, { replace: true });
    } catch (err) {
      const msg = (err as Error).message;
      toast.error(msg);
      // Estoque mudou enquanto a cliente decidia: recarrega para a sacola se ajustar.
      if (/estoque|dispon/i.test(msg)) reload();
    } finally {
      setSending(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-32 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 s-gold" />
        <h1 className="s-display mt-6 text-4xl">Sua sacola está vazia</h1>
        <p className="mt-3 s-muted">Escolha suas peças favoritas e elas aparecem aqui.</p>
        <Link to="/loja" className="s-btn s-btn-gold mt-8">Ver a coleção <ArrowRight /></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <p className="s-eyebrow">Finalizar</p>
      <h1 className="s-display mt-2 text-5xl">Sua sacola</h1>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_440px]">
        <ul className="space-y-4">
          {cart.map((l) => {
            const k = lineKey(l);
            return (
              <li key={k} className="s-card flex gap-4 p-4">
                <Link to={`/loja/produto/${l.productId}`} className="h-32 w-24 shrink-0 overflow-hidden rounded-xl">
                  <img src={l.image} alt="" className="h-full w-full object-cover" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/loja/produto/${l.productId}`} className="s-link line-clamp-2 font-medium">
                        {displayName(l.name)}
                      </Link>
                      {variantLabel(l) && <p className="mt-1 text-sm s-muted">{variantLabel(l)}</p>}
                    </div>
                    <button type="button" className="s-icon-btn shrink-0" onClick={() => removeLine(k)} aria-label="Remover da sacola">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="flex h-10 items-center rounded-full border border-[color:var(--s-line-strong)]">
                      <button type="button" className="s-icon-btn !h-9 !w-9" onClick={() => setLineQty(k, l.quantity - 1)} disabled={l.quantity <= 1} aria-label="Diminuir">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-sm tabular-nums">{l.quantity}</span>
                      <button type="button" className="s-icon-btn !h-9 !w-9" onClick={() => setLineQty(k, l.quantity + 1)} disabled={l.quantity >= l.maxQty} aria-label="Aumentar">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="font-semibold tabular-nums s-gold">{fmtBRL(l.price * l.quantity)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <form onSubmit={submit} className="s-card h-fit space-y-5 p-6 lg:sticky lg:top-24">
          <div className="flex items-baseline justify-between">
            <span className="s-muted">Subtotal</span>
            <span className="text-2xl font-semibold tabular-nums s-gold">{fmtBRL(cartTotal)}</span>
          </div>
          {form.delivery === "entrega" && (
            <p className="-mt-3 text-xs s-muted">Frete combinado com você pelo WhatsApp.</p>
          )}

          <div className="border-t pt-5 s-divider">
            <label className="s-label" htmlFor="c-name">Nome</label>
            <input id="c-name" className="s-input" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="s-label" htmlFor="c-phone">WhatsApp</label>
              <input
                id="c-phone"
                className="s-input"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 98765-4321"
                value={maskPhone(form.phone)}
                onChange={(e) => set("phone", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="s-label" htmlFor="c-email">E-mail (opcional)</label>
              <input id="c-email" type="email" className="s-input" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>

          <fieldset>
            <legend className="s-label">Como quer receber?</legend>
            <div className="grid grid-cols-2 gap-3">
              {([
                { v: "retirada", label: "Retirar na loja", Icon: Store },
                { v: "entrega", label: "Receber em casa", Icon: Truck },
              ] as const).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("delivery", v)}
                  aria-pressed={form.delivery === v}
                  className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left text-sm transition ${
                    form.delivery === v ? "border-[color:var(--s-gold)] bg-white/[0.04]" : "border-[color:var(--s-line)]"
                  }`}
                >
                  <Icon className="h-5 w-5 s-gold" />
                  {label}
                </button>
              ))}
            </div>
            {form.delivery === "retirada" && settings?.pickup_address && (
              <p className="mt-3 text-xs s-muted">Retirada em: {settings.pickup_address}</p>
            )}
            {form.delivery === "entrega" && settings?.delivery_note && (
              <p className="mt-3 text-xs s-muted">{settings.delivery_note}</p>
            )}
          </fieldset>

          {form.delivery === "entrega" && (
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3">
                <label className="s-label" htmlFor="c-cep">CEP</label>
                <div className="relative">
                  <input id="c-cep" className="s-input" inputMode="numeric" autoComplete="postal-code" value={form.cep} onChange={(e) => set("cep", e.target.value)} />
                  {cepLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin s-muted" />}
                </div>
              </div>
              <div className="col-span-3">
                <label className="s-label" htmlFor="c-number">Número</label>
                <input id="c-number" className="s-input" value={form.number} onChange={(e) => set("number", e.target.value)} />
              </div>
              <div className="col-span-6">
                <label className="s-label" htmlFor="c-street">Rua</label>
                <input id="c-street" className="s-input" autoComplete="address-line1" value={form.street} onChange={(e) => set("street", e.target.value)} />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="s-label" htmlFor="c-comp">Complemento</label>
                <input id="c-comp" className="s-input" value={form.complement} onChange={(e) => set("complement", e.target.value)} />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="s-label" htmlFor="c-bairro">Bairro</label>
                <input id="c-bairro" className="s-input" value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />
              </div>
              <div className="col-span-4">
                <label className="s-label" htmlFor="c-city">Cidade</label>
                <input id="c-city" className="s-input" autoComplete="address-level2" value={form.city} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="s-label" htmlFor="c-uf">UF</label>
                <input id="c-uf" className="s-input uppercase" maxLength={2} value={form.state} onChange={(e) => set("state", e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className="s-label" htmlFor="c-notes">Observações (opcional)</label>
            <textarea id="c-notes" rows={2} className="s-input" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Ex.: prefiro retirar sábado" />
          </div>

          <button type="submit" className="s-btn s-btn-gold w-full !h-14 !text-base" disabled={sending}>
            {sending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            {sending ? "Enviando pedido…" : "Enviar pedido"}
          </button>
          <p className="text-center text-xs leading-relaxed s-muted">
            As peças ficam reservadas para você. Nossa equipe chama no WhatsApp para combinar o pagamento
            {form.delivery === "entrega" ? " e o frete" : " e a retirada"}.
          </p>
        </form>
      </div>
    </div>
  );
}
