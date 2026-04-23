// Converte qualquer imagem em WebP 512x512 ≤100KB (formato exigido pela Meta para stickers).
export async function toStickerWebp(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    // fundo transparente
    ctx.clearRect(0, 0, 512, 512);
    const scale = Math.min(512 / img.width, 512 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);

    let q = 0.92;
    let blob: Blob | null = null;
    do {
      blob = await new Promise<Blob>((r) =>
        canvas.toBlob((b) => r(b!), "image/webp", q),
      );
      q -= 0.08;
    } while (blob && blob.size > 100 * 1024 && q > 0.4);

    if (!blob) throw new Error("Falha ao gerar WebP");
    return new File([blob], `sticker-${Date.now()}.webp`, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
