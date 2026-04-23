/** Strip all non-digit characters from a CPF/CNPJ string */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Format CPF (11 digits) or CNPJ (14 digits) for display. Returns the input as-is if not 11/14 digits. */
export function formatTaxId(value: string | null | undefined): string {
  const d = digitsOnly(value);
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return value ?? "";
}

/** Validate length only (11 = CPF, 14 = CNPJ). Empty is valid (optional field). */
export function isValidTaxIdLength(value: string | null | undefined): boolean {
  const d = digitsOnly(value);
  return d.length === 0 || d.length === 11 || d.length === 14;
}
