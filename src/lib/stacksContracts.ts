// src/lib/stacksContracts.ts
// Stacks contract addresses, API helpers, and crypto utilities for ThesisAI.

export const CONTRACTS = {
  THESIS_TOKEN: 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesisai',
  THESIS_REGISTRY: (import.meta as any).env.VITE_STACKS_THESIS_REGISTRY ?? 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry',
  THESIS_NFT: (import.meta as any).env.VITE_STACKS_THESIS_NFT ?? 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate',
} as const;

export const HIRO_API = 'https://api.hiro.so';
export const TOKEN_DECIMALS = 6;
export const TOKEN_TOTAL_SUPPLY = 999_000_000;

// Canonical contract principal + asset name used by FT endpoints
const CONTRACT_PRINCIPAL = 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesisai';
const ASSET_NAME = 'Thesis';

/**
 * Fetch the $THESIS token balance for a given Stacks address.
 * Returns the human-readable balance (divided by 10^6).
 */
export async function fetchThesisBalance(address: string): Promise<number> {
  try {
    const res = await fetch(
      `${HIRO_API}/v2/accounts/${address}/balances`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    // Key format: "CONTRACT_PRINCIPAL::ASSET_NAME"
    const key = `${CONTRACT_PRINCIPAL}::${ASSET_NAME}`;
    const micro = data?.fungible_tokens?.[key]?.balance ?? '0';
    return Number(micro) / Math.pow(10, TOKEN_DECIMALS);
  } catch {
    return 0;
  }
}

/**
 * Fetch the total number of unique $THESIS token holders from Stacks mainnet.
 * Uses multiple Hiro API endpoints for resilience.
 */
export async function fetchThesisHolderCount(): Promise<number> {
  // Strategy 1: FT holders endpoint — returns total holder count
  try {
    const url = `${HIRO_API}/extended/v1/tokens/ft/${CONTRACT_PRINCIPAL}/holders?limit=1&offset=0`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      // Hiro returns { total: N, results: [...] }
      const total = Number(data?.total ?? 0);
      if (total > 0) return total;
      // If total is 0 but results exist, count results
      if (Array.isArray(data?.results) && data.results.length > 0) return data.results.length;
    }
  } catch { /* fall through */ }

  // Strategy 2: token metadata endpoint — has holder_count field
  try {
    const url = `${HIRO_API}/extended/v1/tokens/ft/${CONTRACT_PRINCIPAL}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const count = Number(data?.holder_count ?? data?.holders ?? 0);
      if (count > 0) return count;
    }
  } catch { /* fall through */ }

  // Strategy 3: v2 FT list endpoint
  try {
    const url = `${HIRO_API}/extended/v2/tokens/ft?principal=${CONTRACT_PRINCIPAL}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const count = Number(data?.results?.[0]?.holder_count ?? 0);
      if (count > 0) return count;
    }
  } catch { /* fall through */ }

  // Strategy 4: Use the accounts endpoint to get holders by fetching all with pagination
  // This is a best-effort fallback: list top holders to at least get a minimum count
  try {
    const url = `${HIRO_API}/extended/v1/tokens/ft/${CONTRACT_PRINCIPAL}/holders?limit=200`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const total = Number(data?.total ?? 0);
      if (total > 0) return total;
      if (Array.isArray(data?.results)) return data.results.length;
    }
  } catch { /* fall through */ }

  return 0;
}

/**
 * Compute SHA-256 hash of a string and return as a lowercase hex string.
 */
export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string to a Uint8Array of bytes.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
