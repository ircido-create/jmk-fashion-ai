import { useEffect, useRef, useState } from "react";
import { GARMENT_LABEL, GARMENT_TYPES, isGarmentType } from "@/lib/garments";
import { problemaNaFoto } from "@/lib/fotoEnviada";
import { galeriaDoEditor, MAX_FOTOS_DA_PECA } from "@/lib/galeriaProduto";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/utils";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Layers, AlertTriangle, FileUp, Loader2, Image as ImageIcon, Upload, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import SupplierImageSearch from "@/components/SupplierImageSearch";
import { usePagination } from "@/hooks/usePagination";
import { importRomaneioPhotos, reprocessRomaneioPhotos } from "@/lib/romaneioPhotos";

interface Variant { id?: string; size: string; color: string; quantity: number; image_url?: string | null; }
interface Product {
  id: string; name: string; description: string | null; category: string | null;
  sku: string | null; supplier: string | null;
  price: number; cost: number; low_stock_threshold: number; active: boolean;
  /** Preço "de" da loja virtual: aparece riscado ao lado do preço de venda. */
  compare_at_price?: number | null;
  image_url?: string | null;
  /** Galeria da peça, em ordem; a primeira é a capa (espelha image_url). */
  images?: string[] | null;
  garment_type?: string | null;
  /** Aparece na loja virtual (jmkmodas.com.br/loja). */
  store_visible?: boolean;
  /** Rascunho do romaneio, ainda sem conferir: a vitrine ignora. */
  is_draft?: boolean;
  product_variants?: Variant[];
}

/**
 * Limite da descrição. Era 500 e barrava as descrições que a IA escreve a
 * partir do romaneio (cores, tecido, caimento), que passam disso com facilidade.
 * O banco não tem limite nenhum nessa coluna.
 */
const MAX_DESCRICAO = 2000;

/**
 * As mensagens são nossas, em português, e começam pelo nome do campo.
 *
 * Nada de `.or(z.literal(""))`: quando os dois lados de um `.or` falham, o zod 4
 * devolve só **"Invalid input"**, sem dizer qual campo nem por quê — foi o erro
 * que o José levou na tela em 13/11/2026, sem nenhuma pista do que corrigir.
 * Reproduzi no zod 4.3: a união devolve "Invalid input" quando o valor é null
 * (campo que não foi para o FormData) e quando o tipo de peça está fora da
 * lista; o texto comprido, esse, já dizia "Too big". Campo de texto vazio passa
 * por `max()` sem o `.or`, que nunca foi preciso.
 */
const schema = z.object({
  name: z.string().trim().min(2, "Nome: escreva pelo menos 2 letras")
                  .max(100, "Nome: no máximo 100 caracteres"),
  sku: z.string().trim().max(60, "SKU: no máximo 60 caracteres").optional(),
  supplier: z.string().trim().max(120, "Fornecedor: no máximo 120 caracteres").optional(),
  category: z.string().trim().max(60, "Categoria: no máximo 60 caracteres").optional(),
  garment_type: z.string().trim().refine(
    (v) => v === "" || (GARMENT_TYPES as readonly string[]).includes(v),
    "Tipo de peça: escolha um da lista",
  ),
  description: z.string().trim()
                .max(MAX_DESCRICAO, `Descrição: no máximo ${MAX_DESCRICAO} caracteres`)
                .optional(),
  price: z.number().nonnegative("Preço: não pode ser negativo"),
  cost: z.number().nonnegative("Custo: não pode ser negativo"),
  compare_at_price: z.number().nonnegative('Preço "De": não pode ser negativo').nullable(),
  low_stock_threshold: z.number().int("Estoque mínimo: use um número inteiro")
                        .nonnegative("Estoque mínimo: não pode ser negativo"),
});

/**
 * Campo de texto vindo do formulário. `f.get()` devolve null quando o campo
 * não existe (ou está desabilitado) e null é justamente o que fazia o zod
 * dizer "Invalid input" sem dizer mais nada. Vazio é a resposta certa aí.
 */
function textoDoCampo(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

/**
 * Campo de dinheiro vindo do formulário. Vazio vale zero; vírgula vale ponto
 * (o teclado do celular manda vírgula); o que não for número volta como NaN
 * para o chamador avisar com o nome do campo.
 */
function valorDoCampo(v: FormDataEntryValue | null): number {
  const texto = String(v ?? "").trim().replace(",", ".");
  if (texto === "") return 0;
  const n = Number(texto);
  return Number.isFinite(n) ? n : NaN;
}

export default function Inventory() {
  const [list, setList] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  // controlado, para contar os caracteres enquanto se digita
  const [descricao, setDescricao] = useState("");
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  // "todas" | "na-loja" | "fora" | "nao-aparece"
  const [lojaFilter, setLojaFilter] = useState<string>("todas");
  const [fotoFilter, setFotoFilter] = useState<string>("todas");
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessMsg, setReprocessMsg] = useState<string>("");
  const [importProgress, setImportProgress] = useState<Array<{ name: string; status: "pending" | "running" | "ok" | "skip" | "err"; msg?: string; retriable?: boolean }>>([]);
  const cancelImportRef = useRef(false);
  const [imgSearchOpen, setImgSearchOpen] = useState(false);
  const [imgSearchTarget, setImgSearchTarget] = useState<{
    productName: string;
    supplier?: string | null;
    variantId?: string;
    productId?: string;
    applyToAllVariants?: boolean;
    onLocal?: (url: string) => void;
  } | null>(null);

  const openImgSearchForVariant = (i: number) => {
    const name = (document.querySelector('input[name="name"]') as HTMLInputElement | null)?.value || editing?.name || "";
    const sup = (document.querySelector('input[name="supplier"]') as HTMLInputElement | null)?.value || editing?.supplier || "";
    if (!name) { toast.error("Preencha o nome do produto primeiro"); return; }
    setImgSearchTarget({
      productName: name,
      supplier: sup,
      variantId: variants[i]?.id,
      onLocal: (url) => updVariant(i, { image_url: url }),
    });
    setImgSearchOpen(true);
  };

  const openImgSearchForProduct = (p: Product) => {
    setImgSearchTarget({
      productName: p.name,
      supplier: p.supplier,
      productId: p.id,
      applyToAllVariants: true,
    });
    setImgSearchOpen(true);
  };

  const handleImport = async (filesOverride?: File[]) => {
    const source = filesOverride ?? importFiles;
    if (!source.length) { toast.error("Selecione ao menos um PDF"); return; }
    const pdfs = source.filter((f) => f.type === "application/pdf");
    if (!pdfs.length) { toast.error("Apenas PDF é suportado"); return; }

    setImporting(true);
    cancelImportRef.current = false;
    const initial = pdfs.map((f) => ({ name: f.name, status: "pending" as const }));
    setImportProgress(initial);

    const updateItem = (idx: number, patch: Partial<{ status: "pending" | "running" | "ok" | "skip" | "err"; msg: string; retriable: boolean }>) => {
      setImportProgress((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    };

    const photosQueue: File[] = [];
    const duplicates: string[] = [];
    let imported = 0, skipped = 0, failed = 0;
    let cancelled = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const invokeWithRetry = async (path: string, file_hash: string, filename: string) => {
      const delays = [0, 2000, 5000];
      let lastErr: any;
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await sleep(delays[attempt]);
        try {
          const { data, error } = await supabase.functions.invoke("parse-romaneio", {
            body: { storage_path: path, file_hash, filename },
          });
          if (error) {
            const msg = String(error.message || "");
            const ctx: any = (error as any).context;
            const status: number | undefined = ctx?.status ?? ctx?.response?.status;
            const retriable = status === 429 || (status && status >= 500) || /fetch|network|timeout/i.test(msg);
            if (retriable && attempt < delays.length - 1) { lastErr = error; continue; }
            throw error;
          }
          return data;
        } catch (e: any) {
          lastErr = e;
          if (attempt >= delays.length - 1) throw e;
        }
      }
      throw lastErr;
    };

    const processOne = async (file: File, idx: number) => {
      if (cancelled) return;
      updateItem(idx, { status: "running" });
      try {
        const buf = await file.arrayBuffer();
        const hashBuf = await crypto.subtle.digest("SHA-256", buf);
        const file_hash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0")).join("");

        const { data: existing } = await supabase
          .from("imported_romaneios")
          .select("id, filename, created_at")
          .eq("file_hash", file_hash)
          .maybeSingle();
        if (existing) {
          skipped++;
          duplicates.push(file.name);
          const when = existing.created_at
            ? new Date(existing.created_at).toLocaleDateString("pt-BR")
            : "";
          updateItem(idx, { status: "skip", msg: `romaneio já importado${when ? ` em ${when}` : ""} — não importado` });
          toast.warning(`"${file.name}" já foi importado${when ? ` em ${when}` : ""}. Importação ignorada.`, { duration: 6000 });
          return;
        }

        const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("romaneios").upload(path, file);
        if (upErr) throw upErr;

        const data = await invokeWithRetry(path, file_hash, file.name);
        if (data?.error) throw new Error(data.error);
        if (data?.skipped) {
          skipped++;
          const isHash = data.reason === "hash";
          if (isHash) duplicates.push(file.name);
          const label = isHash ? "romaneio já importado — não importado" : data.reason === "no_items" ? "IA não leu itens" : "duplicado";
          updateItem(idx, { status: "skip", msg: label, retriable: !isHash });
          if (isHash) toast.warning(`"${file.name}" já foi importado. Importação ignorada.`, { duration: 6000 });
          return;
        }
        imported++;
        updateItem(idx, { status: "ok", msg: `${data.products_created || 0} novos · ${data.variants_added || 0} var · ${data.payable_created || 0} conta(s)${data.attempts > 1 ? ` · ${data.attempts}ª tent.` : ""}` });
        photosQueue.push(file);
      } catch (e: any) {
        failed++;
        updateItem(idx, { status: "err", msg: e?.message?.slice(0, 120) || "erro", retriable: true });
      }
    };

    // beforeunload guard
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);

    try {
      // concurrency pool = 3
      const CONCURRENCY = 3;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, pdfs.length) }, async () => {
        while (true) {
          if (cancelImportRef.current) cancelled = true;
          if (cancelled) return;
          const myIdx = cursor++;
          if (myIdx >= pdfs.length) return;
          await processOne(pdfs[myIdx], myIdx);
        }
      });
      await Promise.all(workers);

      toast.success(`Importação concluída: ${imported} importado(s), ${skipped} pulado(s), ${failed} com erro${cancelled ? " (cancelado)" : ""}`, { duration: 6000 });
      if (duplicates.length) {
        toast.warning(
          `${duplicates.length} romaneio(s) já importado(s) anteriormente e não foram importados novamente: ${duplicates.join(", ")}`,
          { duration: 10000 }
        );
      }
      load();

      if (photosQueue.length) {
        const photoToast = toast.loading(`Importando fotos de ${photosQueue.length} romaneio(s)...`);
        (async () => {
          let totalPhotos = 0;
          let photoFails = 0;
          let lastWarning: string | undefined;
          for (const f of photosQueue) {
            const res = await importRomaneioPhotos(f);
            totalPhotos += res.imported;
            if (res.warning) { photoFails++; lastWarning = res.warning; }
          }
          if (totalPhotos > 0) {
            toast.success(
              `Fotos do romaneio importadas com sucesso: ${totalPhotos} foto(s)${photoFails ? ` — ${photoFails} PDF(s) com falha` : ""}`,
              { id: photoToast, duration: 6000 }
            );
            load();
          } else if (photoFails) {
            toast.error(`Não foi possível importar as fotos do romaneio${lastWarning ? `: ${lastWarning}` : ""}`, { id: photoToast, duration: 6000 });
          } else {
            toast.info("Importação concluída, mas nenhuma foto foi encontrada no romaneio", { id: photoToast, duration: 6000 });
          }
        })();
      } else {
        toast.info("Importação concluída (sem PDFs elegíveis para extração de fotos)");
      }

    } catch (e: any) {
      toast.error("Falha na importação: " + (e?.message || "erro desconhecido"));
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
      setImporting(false);
    }
  };


  const load = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*, product_variants(*)")
      .order("name");
    if (error) toast.error(error.message);
    else setList((data ?? []) as Product[]);
  };

  useEffect(() => { load(); }, []);


  const openNew = () => {
    setEditing(null); setVariants([]); setPhotos([]); setDescricao(""); setOpen(true);
  };

  const handleReprocessPhotos = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    setReprocessMsg("Iniciando...");
    try {
      const res = await reprocessRomaneioPhotos((cur, total, name) => {
        setReprocessMsg(`Processando ${cur}/${total}: ${name}`);
      });
      toast.success(`${res.imported} foto(s) importada(s) de ${res.processed} romaneio(s)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reprocessar");
    } finally {
      setReprocessing(false);
      setReprocessMsg("");
    }
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setVariants(p.product_variants?.map((v) => ({ id: v.id, size: v.size, color: v.color, quantity: v.quantity, image_url: v.image_url ?? null })) ?? []);
    // Produto antigo pode ter só a foto de capa, e o buscador de foto grava só
    // ela: galeriaDoEditor garante que salvar não desfaça a capa que está no ar.
    setPhotos(galeriaDoEditor(p));
    setDescricao(p.description ?? "");
    setOpen(true);
  };

  /** Sobe as fotos escolhidas e acrescenta à galeria, na ordem da seleção. */
  const uploadProductPhotos = async (files: File[]) => {
    const livres = Math.max(0, MAX_FOTOS_DA_PECA - photos.length);
    if (livres === 0) { toast.error(`Máximo de ${MAX_FOTOS_DA_PECA} fotos por peça`); return; }
    setUploadingPhotos(true);
    const novas: string[] = [];
    for (const file of files.slice(0, livres)) {
      const problema = problemaNaFoto(file);
      if (problema) { toast.error(problema); continue; }
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
      if (upErr) { toast.error("Falha no upload: " + upErr.message); continue; }
      novas.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    }
    if (novas.length) {
      setPhotos((prev) => [...prev, ...novas]);
      toast.success(novas.length === 1 ? "Foto adicionada" : `${novas.length} fotos adicionadas`);
    }
    if (files.length > livres) toast.info(`Só couberam ${livres}: o limite é ${MAX_FOTOS_DA_PECA} fotos por peça.`);
    setUploadingPhotos(false);
  };

  const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, j) => j !== i));
  /** A capa é a primeira: escolher outra foto só a traz para a frente. */
  const makeCover = (i: number) => setPhotos((prev) => [prev[i], ...prev.filter((_, j) => j !== i)]);

  const uploadVariantImage = async (i: number, file: File) => {
    const problema = problemaNaFoto(file);
    if (problema) { toast.error(problema); return; }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
    if (upErr) { toast.error("Falha no upload: " + upErr.message); return; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    updVariant(i, { image_url: data.publicUrl });
    toast.success("Foto adicionada");
  };

  const descricaoLonga = descricao.trim().length > MAX_DESCRICAO;

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    // Dinheiro primeiro: assim "abc" vira um aviso com o nome do campo, e não
    // o "Invalid input" que o zod devolve para NaN.
    const preco = valorDoCampo(f.get("price"));
    const custo = valorDoCampo(f.get("cost"));
    const temDe = String(f.get("compare_at_price") ?? "").trim() !== "";
    const de = temDe ? valorDoCampo(f.get("compare_at_price")) : null;
    const minimo = valorDoCampo(f.get("low_stock_threshold"));

    for (const [rotulo, valor] of [
      ["Preço", preco], ["Custo", custo], ['Preço "De"', de ?? 0], ["Estoque mínimo", minimo],
    ] as const) {
      if (Number.isNaN(valor)) { toast.error(`${rotulo}: preencha com um número`); return; }
    }

    const parsed = schema.safeParse({
      name: textoDoCampo(f.get("name")),
      sku: textoDoCampo(f.get("sku")),
      supplier: textoDoCampo(f.get("supplier")),
      category: textoDoCampo(f.get("category")),
      garment_type: textoDoCampo(f.get("garment_type")),
      description: textoDoCampo(f.get("description")),
      price: preco,
      cost: custo,
      // Campo vazio é "sem oferta", não zero.
      compare_at_price: de,
      low_stock_threshold: minimo || 5,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    // Anunciar "de" menor que o "por" é propaganda enganosa: a loja não mostra
    // e o cadastro também não aceita, para ninguém achar que gravou.
    const precoDe = parsed.data.compare_at_price;
    if (precoDe !== null && precoDe > 0 && precoDe <= parsed.data.price) {
      toast.error('O preço "De" precisa ser maior que o preço de venda.');
      return;
    }
    const payload = {
      name: parsed.data.name,
      sku: parsed.data.sku || null,
      supplier: parsed.data.supplier || null,
      description: parsed.data.description || null,
      category: parsed.data.category || null,
      garment_type: parsed.data.garment_type || null,
      // Checkbox fora do schema: o navegador manda "on" marcado e nada desmarcado.
      store_visible: f.get("store_visible") === "on",
      images: photos,
      // A capa continua em image_url: PDV, cupom e WhatsApp leem esse campo.
      image_url: photos[0] ?? null,
      price: parsed.data.price,
      compare_at_price: precoDe && precoDe > 0 ? precoDe : null,
      cost: parsed.data.cost,
      low_stock_threshold: parsed.data.low_stock_threshold,
    };

    let productId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("products").insert(payload).select().single();
      if (error || !data) { toast.error(error?.message || "Erro"); return; }
      productId = data.id;
    }

    // Sync variants
    if (productId) {
      await supabase.from("product_variants").delete().eq("product_id", productId);
      if (variants.length > 0) {
        const toInsert = variants
          .filter((v) => v.size || v.color)
          .map((v) => ({
            product_id: productId,
            size: v.size || null,
            color: v.color || null,
            quantity: Number(v.quantity) || 0,
            image_url: v.image_url || null,
          }));
        if (toInsert.length > 0) {
          const { error: ve } = await supabase.from("product_variants").insert(toInsert);
          if (ve) toast.error("Erro nas variações: " + ve.message);
        }
      }
    }

    toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir produto e suas variações?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); load(); }
  };

  const addVariant = () => setVariants((v) => [...v, { size: "", color: "", quantity: 0 }]);
  const updVariant = (i: number, patch: Partial<Variant>) =>
    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const delVariant = (i: number) => setVariants((v) => v.filter((_, idx) => idx !== i));

  const totalQty = (p: Product) => p.product_variants?.reduce((s, v) => s + v.quantity, 0) ?? 0;
  const isLow = (p: Product) => totalQty(p) <= p.low_stock_threshold;

  /**
   * Mesma regra da vitrine, escrita igual à do banco (store_catalog, migração
   * 20261028170000): a peça tem de estar ativa, não ser rascunho, estar
   * marcada para a loja, ter preço, ter alguma foto — capa, galeria ou a foto
   * de uma variação que ainda tenha peça — e ter estoque (peça sem nenhuma
   * variação cadastrada também entra, como no banco).
   *
   * Marcar a chave não basta, e era aí que a gente se perdia: a peça ficava
   * marcada no Estoque e não aparecia para a cliente, sem nada dizer por quê.
   */
  const temFoto = (p: Product) =>
    !!p.image_url ||
    (p.images?.length ?? 0) > 0 ||
    (p.product_variants ?? []).some((v) => !!v.image_url && v.quantity > 0);
  const temEstoque = (p: Product) =>
    (p.product_variants?.length ?? 0) === 0 || totalQty(p) > 0;
  const apareceNaLoja = (p: Product) =>
    p.store_visible === true &&
    p.active !== false &&
    p.is_draft !== true &&
    Number(p.price) > 0 &&
    temEstoque(p) &&
    temFoto(p);

  /** O que falta para a peça marcada aparecer — o primeiro motivo basta. */
  const porQueNaoAparece = (p: Product) =>
    p.active === false ? "peça inativa"
    : p.is_draft === true ? "rascunho do romaneio"
    : !(Number(p.price) > 0) ? "sem preço"
    : !temEstoque(p) ? "sem estoque"
    : !temFoto(p) ? "sem foto"
    : "";

  const suppliers = Array.from(new Set(list.map((p) => p.supplier).filter((s): s is string => !!s && s.trim() !== ""))).sort();

  /**
   * Foto da peça, para o filtro do acervo.
   *
   * "Capa" é o que aparece no card daqui, no PDV e no cupom: `image_url` ou a
   * galeria. A foto que está só na variação é caso à parte de propósito — a
   * peça aparece bonita na loja (a vitrine aceita foto de variação) e fica
   * preta aqui dentro, que foi o que aconteceu com a SAIA VILMA em 13/11/2026.
   * Separar os dois casos mostra essas peças antes de a cliente ver.
   */
  const temCapa = (p: Product) => !!p.image_url || (p.images?.length ?? 0) > 0;
  const soNaVariacao = (p: Product) =>
    !temCapa(p) && (p.product_variants ?? []).some((v) => !!v.image_url);
  const semFotoNenhuma = (p: Product) => !temCapa(p) && !soNaVariacao(p);

  // contagens do acervo inteiro, não do que está filtrado: são elas que
  // aparecem no próprio seletor.
  const comFoto = list.filter(temCapa).length;
  const fotoSoNaVariacao = list.filter(soNaVariacao).length;
  const semFoto = list.filter(semFotoNenhuma).length;
  const naLoja = list.filter(apareceNaLoja).length;
  const naoAparecem = list.filter((p) => p.store_visible === true && !apareceNaLoja(p)).length;
  const foraDaLoja = list.filter((p) => p.store_visible !== true).length;

  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = list.filter((p) => {
    const q = debouncedSearch.toLowerCase();
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q) ||
      (p.supplier ?? "").toLowerCase().includes(q);
    const matchesSupplier = supplierFilter === "all" || p.supplier === supplierFilter;
    const matchesLoja =
      lojaFilter === "todas" ? true
      : lojaFilter === "na-loja" ? apareceNaLoja(p)
      : lojaFilter === "fora" ? p.store_visible !== true
      : /* nao-aparece */ p.store_visible === true && !apareceNaLoja(p);
    const matchesFoto =
      fotoFilter === "todas" ? true
      : fotoFilter === "com-foto" ? temCapa(p)
      : fotoFilter === "so-variacao" ? soNaVariacao(p)
      : /* sem-foto */ semFotoNenhuma(p);
    return matchesSearch && matchesSupplier && matchesLoja && matchesFoto;
  });
  const { paged, Controls } = usePagination(filtered, 20);

  const stockTotals = filtered.reduce(
    (acc, p) => {
      const qty = totalQty(p);
      acc.units += qty;
      acc.cost += qty * Number(p.cost ?? 0);
      acc.potential += qty * Number(p.price ?? 0);
      return acc;
    },
    { units: 0, cost: 0, potential: 0 }
  );
  const margin = stockTotals.potential - stockTotals.cost;

  return (
    <div>
      <PageHeader
        title="Estoque"
        description={`${list.length} produtos`}
        actions={
          <>
            <Button onClick={() => setImportOpen(true)} variant="outline" className="rounded-xl">
              <FileUp className="h-4 w-4 mr-1" /> Importar romaneio
            </Button>
            <Button onClick={handleReprocessPhotos} disabled={reprocessing} variant="outline" className="rounded-xl" title="Reprocessa PDFs dos romaneios importados para buscar fotos dos produtos sem imagem">
              {reprocessing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-1" />}
              {reprocessing ? (reprocessMsg || "Buscando...") : "Buscar fotos"}
            </Button>
            <Button onClick={openNew} className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
              <Plus className="h-4 w-4 mr-1" /> Novo produto
            </Button>
          </>
        }
      />

      <GlassCard>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto, SKU, categoria ou fornecedor..." className="glass-input pl-10" />
          </div>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="glass-input h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
          >
            <option value="all">Todos os fornecedores</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={lojaFilter}
            onChange={(e) => setLojaFilter(e.target.value)}
            className="glass-input h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
            aria-label="Filtrar pela loja virtual"
          >
            <option value="todas">Loja virtual: todas</option>
            <option value="na-loja">Na loja virtual ({naLoja})</option>
            <option value="nao-aparece">Marcadas, mas não aparecem ({naoAparecem})</option>
            <option value="fora">Fora da loja ({foraDaLoja})</option>
          </select>
          <select
            value={fotoFilter}
            onChange={(e) => setFotoFilter(e.target.value)}
            className="glass-input h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
            aria-label="Filtrar pela foto da peça"
          >
            <option value="todas">Foto: todas</option>
            <option value="com-foto">Com foto ({comFoto})</option>
            <option value="so-variacao">Foto só na variação ({fotoSoNaVariacao})</option>
            <option value="sem-foto">Sem foto nenhuma ({semFoto})</option>
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Peças em estoque</div>
            <div className="text-lg font-semibold mt-0.5">{stockTotals.units}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Investido (custo)</div>
            <div className="text-lg font-semibold mt-0.5">{fmtBRL(stockTotals.cost)}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Potencial de venda</div>
            <div className="text-lg font-semibold mt-0.5 text-primary">{fmtBRL(stockTotals.potential)}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Lucro potencial</div>
            <div className="text-lg font-semibold mt-0.5 text-success">{fmtBRL(margin)}</div>
          </div>
        </div>

        <div className="grid gap-3">
          {paged.map((p) => (
            <div key={p.id} className="p-4 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur hover:bg-white/60 transition-all">
              <div className="flex items-start gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-16 w-16 rounded-xl object-cover border border-border shrink-0" />
                ) : (
                  <div className="h-16 w-16 rounded-xl border border-dashed border-muted-foreground/40 bg-white/20 flex items-center justify-center shrink-0">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    {p.sku && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">SKU: {p.sku}</span>}
                    {p.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{p.category}</span>}
                    {isGarmentType(p.garment_type) && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground">{GARMENT_LABEL[p.garment_type].split(" (")[0]}</span>}
                    {p.supplier && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/30 text-accent-foreground">{p.supplier}</span>}
                    {apareceNaLoja(p) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">Na loja</span>
                    )}
                    {p.store_visible === true && !apareceNaLoja(p) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning-foreground">
                        Marcada, mas não aparece — {porQueNaoAparece(p)}
                      </span>
                    )}
                    {isLow(p) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning-foreground inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Estoque baixo
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {p.compare_at_price != null && Number(p.compare_at_price) > Number(p.price) && (
                      <span className="line-through mr-1">R$ {Number(p.compare_at_price).toFixed(2)}</span>
                    )}
                    R$ {Number(p.price).toFixed(2)} • {totalQty(p)} em estoque
                  </div>
                  {p.product_variants && p.product_variants.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.product_variants.map((v, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary inline-flex items-center gap-1">
                          <Layers className="h-2.5 w-2.5" />
                          {[v.size, v.color].filter(Boolean).join(" / ")}: {v.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openImgSearchForProduct(p)} title="Buscar imagem do fornecedor" className="text-xs">
                    <Sparkles className="h-3.5 w-3.5 mr-1" /> Foto
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nenhum produto</div>}
        </div>
        {Controls}
      </GlassCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} produto</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome</Label><Input name="name" defaultValue={editing?.name} required className="glass-input" /></div>
              <div><Label>SKU</Label><Input name="sku" defaultValue={editing?.sku ?? ""} placeholder="VST-001" className="glass-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Categoria</Label><Input name="category" defaultValue={editing?.category ?? ""} placeholder="Vestido, Blusa..." className="glass-input" /></div>
              <div><Label>Fornecedor</Label><Input name="supplier" defaultValue={editing?.supplier ?? ""} placeholder="Nome do fornecedor" className="glass-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Estoque mínimo</Label><Input name="low_stock_threshold" type="number" defaultValue={editing?.low_stock_threshold ?? 5} min={0} className="glass-input" /></div>
              <div>
                {/* Define a seção da loja virtual e a parte do corpo que a IA veste no provador. */}
                <Label htmlFor="garment_type">Tipo de peça</Label>
                <select
                  id="garment_type"
                  name="garment_type"
                  defaultValue={editing?.garment_type ?? ""}
                  className="glass-input flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Não definido</option>
                  {GARMENT_TYPES.map((t) => <option key={t} value={t}>{GARMENT_LABEL[t]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><Label>Preço (R$)</Label><Input name="price" type="number" step="0.01" defaultValue={editing?.price ?? 0} required className="glass-input" /></div>
              <div>
                <Label>De (R$)</Label>
                <Input
                  name="compare_at_price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="sem oferta"
                  defaultValue={editing?.compare_at_price ?? ""}
                  className="glass-input"
                />
              </div>
              <div><Label>Custo (R$)</Label><Input name="cost" type="number" step="0.01" defaultValue={editing?.cost ?? 0} className="glass-input" /></div>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              O preço <strong>De</strong> é o valor antigo, que aparece riscado na loja virtual
              (&quot;De R$ 280,00 por R$ 196,00&quot;). Deixe em branco quando a peça não estiver em oferta.
            </p>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="description">Descrição</Label>
                <span className={`text-xs ${descricaoLonga ? "text-destructive" : "text-muted-foreground"}`}>
                  {descricao.length}/{MAX_DESCRICAO}
                </span>
              </div>
              <Textarea
                id="description"
                name="description"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="glass-input"
                rows={2}
              />
              {descricaoLonga && (
                <p className="mt-1 text-xs text-destructive">
                  Passou do limite — tire {descricao.trim().length - MAX_DESCRICAO} caractere(s) para salvar.
                </p>
              )}
            </div>

            {/* Galeria da peça: a primeira foto é a capa e vai para o PDV e a loja. */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label>Fotos da peça</Label>
                <label className="inline-flex items-center gap-1 text-sm text-primary cursor-pointer hover:opacity-80">
                  {uploadingPhotos ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {uploadingPhotos ? "Enviando..." : "Adicionar fotos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploadingPhotos}
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (fs.length) uploadProductPhotos(fs);
                    }}
                  />
                </label>
              </div>
              {photos.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma foto ainda. Dá para escolher várias de uma vez — a primeira vira a capa.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {photos.map((url, i) => (
                    <div key={url + i} className="relative">
                      <img
                        src={url}
                        alt={i === 0 ? "Capa" : `Foto ${i + 1}`}
                        className={`h-20 w-20 rounded-xl object-cover border ${i === 0 ? "border-primary" : "border-border"}`}
                      />
                      {i === 0 ? (
                        <span className="absolute bottom-0 inset-x-0 text-[10px] text-center bg-primary/80 text-primary-foreground rounded-b-xl">
                          Capa
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => makeCover(i)}
                          className="absolute bottom-0 inset-x-0 text-[10px] bg-black/60 text-white rounded-b-xl hover:bg-black/80"
                        >
                          Usar como capa
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label={`Remover foto ${i + 1}`}
                        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Até 8 fotos, 5MB cada. A capa aparece no PDV e na vitrine; as demais ficam na página
                da peça na loja.
              </p>
            </div>

            {/* Peça nova nasce fora da vitrine: a loja escolhe uma a uma o que vende on-line. */}
            <label className="flex items-start gap-2 text-sm cursor-pointer rounded-xl bg-white/30 dark:bg-white/5 p-3">
              <input
                type="checkbox"
                name="store_visible"
                defaultChecked={editing?.store_visible === true}
                className="h-4 w-4 mt-0.5"
              />
              <span>
                Mostrar na loja virtual
                <span className="block text-xs text-muted-foreground">
                  Marque para vender esta peça em jmkmodas.com.br/loja — ela aparece quando tiver
                  foto, preço e estoque. Desmarcada, continua normal no PDV.
                </span>
              </span>
            </label>

            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label>Variações (tamanho/cor/qtd)</Label>
                <Button type="button" size="sm" variant="ghost" onClick={addVariant}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
              </div>
              <div className="space-y-3">
                {variants.map((v, i) => (
                  <div key={i} className="p-3 rounded-xl bg-white/30 dark:bg-white/5 space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_80px_auto] gap-2">
                      <Input placeholder="P/M/G" value={v.size} onChange={(e) => updVariant(i, { size: e.target.value })} className="glass-input" />
                      <Input placeholder="Cor" value={v.color} onChange={(e) => updVariant(i, { color: e.target.value })} className="glass-input" />
                      <Input type="number" value={v.quantity} onChange={(e) => updVariant(i, { quantity: Number(e.target.value) })} className="glass-input" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => delVariant(i)} aria-label="Excluir variante"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.image_url ? (
                        <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-border">
                          <img src={v.image_url} alt={`${v.color || "variação"}`} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => updVariant(i, { image_url: null })}
                            className="absolute top-0 right-0 bg-destructive/90 text-destructive-foreground rounded-bl-md p-0.5"
                            aria-label="Remover foto"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded-lg border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                      <label className="cursor-pointer text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition">
                        <Upload className="h-3 w-3" />
                        {v.image_url ? "Trocar foto" : "Adicionar foto"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadVariantImage(i, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => openImgSearchForVariant(i)}
                        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition"
                        title="Buscar imagem no site do fornecedor"
                      >
                        <Sparkles className="h-3 w-3" /> Buscar do fornecedor
                      </button>
                    </div>
                  </div>
                ))}
                {variants.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma variação ainda.</p>}
              </div>
            </div>

            <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground rounded-xl">Salvar</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(o) => { if (!importing) { setImportOpen(o); if (!o) { setImportFiles([]); setImportProgress([]); } } }}>
        <DialogContent className="glass-card border-border max-w-lg">
          <DialogHeader><DialogTitle>Importar romaneios (PDF)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Anexe um ou vários PDFs. Processamos 3 em paralelo com repetição automática em caso de falha.
              Duplicados são detectados e pulados.
            </p>
            <div>
              <Label>Arquivos PDF</Label>
              <Input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(e) => setImportFiles(Array.from(e.target.files ?? []))}
                disabled={importing}
                className="glass-input mt-1"
              />
              {importFiles.length > 0 && importProgress.length === 0 && (
                <ul className="text-xs text-muted-foreground mt-2 space-y-0.5 max-h-32 overflow-auto">
                  {importFiles.map((f, i) => <li key={i}>• {f.name}</li>)}
                </ul>
              )}
            </div>

            {importProgress.length > 0 && (() => {
              const done = importProgress.filter(p => p.status !== "pending" && p.status !== "running").length;
              const pct = Math.round((done / importProgress.length) * 100);
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{done} de {importProgress.length} — {pct}%</span>
                    <span className="text-muted-foreground">
                      ✅ {importProgress.filter(p => p.status === "ok").length} ·
                      ⏭️ {importProgress.filter(p => p.status === "skip").length} ·
                      ❌ {importProgress.filter(p => p.status === "err").length}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <ul className="text-xs space-y-1 max-h-64 overflow-auto border rounded-lg p-2 bg-background/40">
                    {importProgress.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-4 shrink-0">
                          {p.status === "ok" && "✅"}
                          {p.status === "skip" && "⏭️"}
                          {p.status === "err" && "❌"}
                          {p.status === "running" && <Loader2 className="h-3 w-3 animate-spin inline" />}
                          {p.status === "pending" && "·"}
                        </span>
                        <span className="flex-1 truncate">{p.name}</span>
                        {p.msg && <span className="text-muted-foreground text-[10px] truncate max-w-[45%]">{p.msg}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <div className="flex gap-2">
              <Button
                onClick={() => handleImport()}
                disabled={!importFiles.length || importing}
                className="flex-1 bg-gradient-primary text-primary-foreground rounded-xl"
              >
                {importing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processando...</>) : (<><FileUp className="h-4 w-4 mr-2" /> Importar {importFiles.length > 1 ? `${importFiles.length} romaneios` : "romaneio"}</>)}
              </Button>
              {importing && (
                <Button variant="outline" onClick={() => { cancelImportRef.current = true; toast.info("Cancelando após arquivos em voo..."); }} className="rounded-xl">
                  Cancelar
                </Button>
              )}
              {!importing && importProgress.length > 0 && importProgress.some((p) => p.retriable) && (
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    const retryNames = new Set(importProgress.filter((p) => p.retriable).map((p) => p.name));
                    const retryFiles = importFiles.filter((f) => retryNames.has(f.name));
                    if (!retryFiles.length) return;
                    setImportFiles(retryFiles);
                    setImportProgress([]);
                    handleImport(retryFiles);
                  }}
                >
                  Tentar novamente ({importProgress.filter((p) => p.retriable).length})
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>


      {imgSearchTarget && (
        <SupplierImageSearch
          open={imgSearchOpen}
          onOpenChange={(o) => { setImgSearchOpen(o); if (!o) setImgSearchTarget(null); }}
          productName={imgSearchTarget.productName}
          supplier={imgSearchTarget.supplier}
          variantId={imgSearchTarget.variantId}
          productId={imgSearchTarget.productId}
          applyToAllVariants={imgSearchTarget.applyToAllVariants}
          onSaved={(url) => {
            imgSearchTarget.onLocal?.(url);
            load();
          }}
        />
      )}
    </div>
  );
}
