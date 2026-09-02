/** Utilitários de data no fuso de Brasília (America/Sao_Paulo). */

const SP = "America/Sao_Paulo";
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Converte um timestamp (ISO ou Date) para a data local em SP no formato yyyy-MM-dd. */
export function toSaoPauloDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return fmt.format(d);
}

/** Data de hoje (yyyy-MM-dd) no fuso de Brasília. */
export function todaySP(): string {
  return toSaoPauloDate(new Date());
}

/** Primeiro dia do mês corrente (yyyy-MM-dd) no fuso de Brasília. */
export function monthStartSP(): string {
  return `${todaySP().slice(0, 7)}-01`;
}

/** Mês corrente (yyyy-MM) no fuso de Brasília. */
export function monthKeySP(): string {
  return todaySP().slice(0, 7);
}
