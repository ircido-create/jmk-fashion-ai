import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ScannedLabel {
  supplier: string | null;
  code: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  barcode: string | null;
  reference: string | null;
  category: string | null;
  brand: string | null;
  suggested_price: number | null;
  confidence: number;
}

interface Props {
  onScanned: (data: ScannedLabel, photoDataUrl: string) => void;
  className?: string;
}

// Resize image client-side to keep latency/cost low
async function resizeImage(file: File, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function LabelScanner({ onScanned, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const dataUrl = await resizeImage(file);
      navigator.vibrate?.(50);
      const { data, error } = await supabase.functions.invoke("scan-label", {
        body: { image: dataUrl },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha na leitura");
      navigator.vibrate?.([30, 50, 30]);
      onScanned(data.data as ScannedLabel, dataUrl);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao ler etiqueta");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        size="lg"
        className={className}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Lendo etiqueta...
          </>
        ) : (
          <>
            <Camera className="h-5 w-5 mr-2" />
            Escanear Etiqueta
          </>
        )}
      </Button>
    </>
  );
}
