// Leitura de segredos internos: variável da função primeiro, cofre do banco depois.
//
// Os segredos do webhook e da cobrança são gerados no Supabase Vault
// (migração 20260916120000) para ninguém precisar digitá-los — e porque a tela de
// secrets do Lovable já listou segredos que não estavam gravados. Se um valor for
// cadastrado nas variáveis da função, ele vence: permite trocar sem migração.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cache = new Map<string, string>();

export async function getSecret(envName: string, vaultName: string): Promise<string | null> {
  const fromEnv = Deno.env.get(envName);
  if (fromEnv) return fromEnv;

  const cached = cache.get(vaultName);
  if (cached) return cached;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("get_internal_secret", { p_name: vaultName });
  if (error) {
    // Não guarda a falha: um erro momentâneo do banco não pode travar a função até o próximo boot.
    console.error(`getSecret(${vaultName}) falhou:`, error.message);
    return null;
  }
  const value = typeof data === "string" && data.length > 0 ? data : null;
  if (value) cache.set(vaultName, value);
  return value;
}

/** Compara sem vazar pelo tempo de resposta onde as strings divergem. */
export function secretsMatch(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
