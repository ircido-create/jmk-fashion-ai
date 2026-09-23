/**
 * Leitura de planilhas (xlsx/xls/csv) de extrato e de contas a receber.
 * Estava duplicada nos dois diálogos de Contas a Receber.
 */
import * as XLSX from "xlsx";

/**
 * Primeira aba como lista de objetos { coluna: valor } (célula vazia = "").
 *
 * Lê o VALOR da célula, não o texto formatado. Antes (raw: false) a biblioteca
 * devolvia o texto no padrão americano: data do Excel 10/08/2026 virava "8/9/26"
 * (lida como 08/09), e valor 1.234,56 virava "1,234.56" (lido como zero — a
 * linha sumia). Em CSV, "10/08/2026" era adivinhado como data americana; agora
 * CSV é lido como texto puro e interpretado no padrão brasileiro.
 */
export async function readFirstSheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: isCsv });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
}

const norm = (s: string) =>
  String(s ?? "").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Acha a coluna pelo primeiro candidato que casar (igual ou contido, sem acento/maiúscula). */
export function findKey(row: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => norm(k) === norm(c) || norm(k).includes(norm(c)));
    if (k) return k;
  }
  return null;
}

/** "R$ 1.234,56" → 1234.56. Ponto seguido de 3 dígitos é milhar; vírgula é decimal. */
export function parseAmount(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return Number(s) || 0;
}

/** "5/9/26", "05-09-2026", "2026-09-05" ou Date → "2026-09-05" (dia/mês/ano). "" se não reconhecer. */
export function parseDate(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) {
    // A biblioteca devolve datas do Excel como 23:59:59 do dia anterior (hora
    // local); arredonda para o dia mais próximo antes de ler dia/mês/ano.
    const d = new Date(v.getTime() + 30 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
