import { supabase } from "@/integrations/supabase/client";

// Configure pdfjs worker (Vite-compatible)
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - ?url import for worker
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PAGES = 20;
const RENDER_SCALE = 1.6;

async function renderPdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    canvases.push(canvas);
  }
  return canvases;
}

function canvasToDataUrl(canvas: HTMLCanvasElement, maxW = 1400): string {
  if (canvas.width <= maxW) return canvas.toDataURL("image/jpeg", 0.82);
  const ratio = maxW / canvas.width;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.round(canvas.height * ratio);
  c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function cropToBlob(source: HTMLCanvasElement, bbox: { x: number; y: number; w: number; h: number }): Promise<Blob | null> {
  const sx = Math.max(0, Math.floor(bbox.x * source.width));
  const sy = Math.max(0, Math.floor(bbox.y * source.height));
  const sw = Math.min(source.width - sx, Math.floor(bbox.w * source.width));
  const sh = Math.min(source.height - sy, Math.floor(bbox.h * source.height));
  if (sw < 20 || sh < 20) return Promise.resolve(null);
  // Resize to max 800px on longest side
  const maxSide = 800;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const outW = Math.round(sw * scale);
  const outH = Math.round(sh * scale);
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  return new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.85));
}

/**
 * Extrai fotos dos produtos de um PDF de romaneio e salva como imagem principal
 * dos produtos que ainda não têm foto. Silencioso em caso de falha.
 * Retorna quantas fotos foram importadas.
 */
export async function importRomaneioPhotos(file: File): Promise<{ imported: number; warning?: string }> {
  try {
    const canvases = await renderPdfPages(file);
    if (!canvases.length) return { imported: 0 };

    // Buscar TODOS os SKUs de produtos sem imagem (sem limite de 200)
    const prods = await fetchAll<{ id: string; sku: string | null; name: string }>((sb) =>
      sb.from("products").select("id, sku, name").is("image_url", null).not("sku", "is", null)
    );
    if (!prods.length) return { imported: 0 };

    const bySku = new Map<string, { id: string; sku: string | null }>();
    for (const p of prods) {
      const k = normSku(p.sku);
      if (k && !bySku.has(k)) bySku.set(k, p);
    }

    const skus = prods.map((p) => p.sku!).filter(Boolean);
    const pages = canvases.map((c) => canvasToDataUrl(c));

    const { data, error: fnErr } = await supabase.functions.invoke("associate-romaneio-photos", {
      body: { pages, skus },
    });
    if (fnErr || !data?.ok) return { imported: 0, warning: fnErr?.message || data?.error };

    const associations: Array<{ sku: string; page_index: number; bbox: any }> = data.associations ?? [];
    let imported = 0;

    for (const assoc of associations) {
      const canvas = canvases[assoc.page_index];
      if (!canvas) continue;
      const product = bySku.get(normSku(assoc.sku));
      if (!product) continue;
      const blob = await cropToBlob(canvas, assoc.bbox);
      if (!blob) continue;
      const path = `romaneio/${String(assoc.sku).replace(/[^a-zA-Z0-9._-]/g, "_")}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("product-images")
        .upload(path, blob, { upsert: false, contentType: "image/jpeg" });
      if (upErr) continue;
      const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("products")
        .update({ image_url: pub.publicUrl })
        .eq("id", product.id)
        .is("image_url", null);
      if (!updErr) imported++;
    }

    return { imported };
  } catch (e: any) {
    console.error("importRomaneioPhotos error", e);
    return { imported: 0, warning: e?.message };
  }
}

/**
 * Reprocessa todos os PDFs de romaneios já importados para tentar extrair fotos
 * dos produtos que ainda estão sem imagem. Útil quando a primeira tentativa
 * (durante a importação) não conseguiu associar todas as fotos.
 */
export async function reprocessRomaneioPhotos(
  onProgress?: (current: number, total: number, filename: string) => void
): Promise<{ imported: number; processed: number; failed: number }> {
  // 1. Buscar romaneios com storage_path
  const { data: romaneios, error } = await supabase
    .from("imported_romaneios")
    .select("id, filename, storage_path")
    .not("storage_path", "is", null);
  if (error || !romaneios?.length) return { imported: 0, processed: 0, failed: 0 };

  let imported = 0;
  let failed = 0;
  let processed = 0;

  for (const rom of romaneios) {
    processed++;
    onProgress?.(processed, romaneios.length, rom.filename);
    try {
      // Verifica se ainda há produtos sem foto — se não, para
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .is("image_url", null)
        .not("sku", "is", null);
      if (!count) break;

      const { data: blob, error: dlErr } = await supabase.storage
        .from("romaneios")
        .download(rom.storage_path!);
      if (dlErr || !blob) { failed++; continue; }
      const file = new File([blob], rom.filename, { type: "application/pdf" });
      const res = await importRomaneioPhotos(file);
      imported += res.imported;
    } catch {
      failed++;
    }
  }
  return { imported, processed, failed };
}
