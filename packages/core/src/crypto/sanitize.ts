export function sanitizeCryptoConfig(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== 'object') return null;
  const { wallet, ...rest } = config as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (wallet && typeof wallet === 'object') {
    const w = wallet as Record<string, unknown>;
    if (typeof w.address === 'string' && w.address.length > 0) {
      // Workers only need the address for display; the encrypted private key
      // stays at rest in the API and is never shipped to a worker process.
      out.wallet = { address: w.address };
    }
  }
  return out;
}
