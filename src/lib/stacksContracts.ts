// src/lib/stacksContracts.ts
// Stacks contract addresses, API helpers, and crypto utilities for ThesisAI.

import { fetchCallReadOnlyFunction, Cl, ClarityType } from '@stacks/transactions';

export const CONTRACTS = {
  THESIS_TOKEN: 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesisai',
  THESIS_REGISTRY: (import.meta as any).env.VITE_STACKS_THESIS_REGISTRY ?? 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry',
  // v1 - live on mainnet, kept for historical certificates only. Do not mint new
  // certificates through this contract; it has a known access-control bug
  // (see contracts-workspace/tests/thesis-certificate-v1-vulnerability.test.ts).
  THESIS_NFT: (import.meta as any).env.VITE_STACKS_THESIS_NFT ?? 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate',
  // v2 - fixed contract. All new certificate mints go through here. Minting is
  // owner-gated and performed by the backend (see api/index.ts /api/certificates/mint),
  // never directly from the user's wallet.
  THESIS_NFT_V2: (import.meta as any).env.VITE_STACKS_THESIS_NFT_V2 ?? '',
  // New peer-review attestation contract. Anyone with a wallet can call this
  // directly (no backend gating needed - the contract itself prevents
  // self-review and duplicate reviews).
  THESIS_REVIEW: (import.meta as any).env.VITE_STACKS_THESIS_REVIEW ?? '',
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
  // Strategy 1: FT holders endpoint - returns total holder count
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

  // Strategy 2: token metadata endpoint - has holder_count field
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
 * Returns the total number of theses ever anchored on thesis-registry, by
 * counting "thesis-anchored" print events emitted by the contract. Uses
 * limit=0 so the Hiro API returns only the `total` count field without
 * transferring any actual event payloads -- cheap and fast.
 */
export async function getTotalAnchoredTheses(network: 'mainnet' | 'testnet' = 'mainnet'): Promise<number | null> {
  if (!CONTRACTS.THESIS_REGISTRY) return null;
  const host = network === 'mainnet' ? 'api.hiro.so' : 'api.testnet.hiro.so';

  try {
    const res = await fetch(`https://${host}/extended/v1/contract/${CONTRACTS.THESIS_REGISTRY}/events?limit=0&offset=0`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.total === 'number' ? data.total : null;
  } catch {
    return null;
  }
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

export type ThesisProof = {
  owner: string;
  block: number;
  title: string;
};

export type ReviewStats = {
  totalRating: number;
  reviewCount: number;
  averageRating: number; // already divided by 100, e.g. 4.5
};

const parseContractId = (contractId: string): [string, string] => {
  const [address, name] = contractId.split('.');
  if (!address || !name) throw new Error(`Invalid contract id: ${contractId}`);
  return [address, name];
};

/**
 * Looks up a thesis hash in thesis-registry and returns its anchor proof,
 * or null if the hash was never anchored. Used by the public "Verify
 * Thesis" page so anyone (no wallet required) can confirm a thesis's
 * on-chain provenance.
 */
export async function verifyThesis(hashHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<ThesisProof | null> {
  if (!CONTRACTS.THESIS_REGISTRY) throw new Error('Registry contract not configured.');
  const [contractAddress, contractName] = parseContractId(CONTRACTS.THESIS_REGISTRY);

  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-proof',
    functionArgs: [Cl.buffer(hexToBytes(hashHex))],
    network,
    senderAddress: contractAddress,
  });

  // get-proof returns (optional (tuple (owner principal) (block uint) (title (string-utf8 200))))
  if (result.type !== ClarityType.OptionalSome) return null;

  const tuple = result.value;
  if (tuple.type !== ClarityType.Tuple) return null;

  const ownerCV = tuple.value['owner'];
  const blockCV = tuple.value['block'];
  const titleCV = tuple.value['title'];

  const owner = ownerCV?.type === ClarityType.PrincipalStandard || ownerCV?.type === ClarityType.PrincipalContract
    ? (ownerCV as any).value
    : '';
  const block = blockCV?.type === ClarityType.UInt ? Number((blockCV as any).value) : 0;
  const title = titleCV?.type === ClarityType.StringUTF8 ? (titleCV as any).value : '';

  return { owner, block, title };
}

/**
 * Checks whether a certificate has already been minted for this hash on
 * thesis-certificate-v2 (returns the token id if so, or null).
 */
export async function getCertificateForHash(hashHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<number | null> {
  if (!CONTRACTS.THESIS_NFT_V2) return null;
  const [contractAddress, contractName] = parseContractId(CONTRACTS.THESIS_NFT_V2);

  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-certificate-for-hash',
    functionArgs: [Cl.buffer(hexToBytes(hashHex))],
    network,
    senderAddress: contractAddress,
  });

  if (result.type !== ClarityType.OptionalSome) return null;
  const tokenIdCV = result.value;
  return tokenIdCV.type === ClarityType.UInt ? Number((tokenIdCV as any).value) : null;
}

/**
 * Fetches aggregate peer-review stats for a thesis hash from thesis-review.
 * Returns zeroed stats (not null) if the contract isn't configured yet or
 * the hash has no reviews -- this matches the contract's own behavior of
 * returning a zeroed tuple rather than none.
 */
export async function getReviewStats(hashHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<ReviewStats> {
  const zero: ReviewStats = { totalRating: 0, reviewCount: 0, averageRating: 0 };
  if (!CONTRACTS.THESIS_REVIEW) return zero;
  const [contractAddress, contractName] = parseContractId(CONTRACTS.THESIS_REVIEW);

  try {
    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: 'get-review-stats',
      functionArgs: [Cl.buffer(hexToBytes(hashHex))],
      network,
      senderAddress: contractAddress,
    });

    if (result.type !== ClarityType.Tuple) return zero;
    const totalRatingCV = result.value['total-rating'];
    const reviewCountCV = result.value['review-count'];
    const totalRating = totalRatingCV?.type === ClarityType.UInt ? Number((totalRatingCV as any).value) : 0;
    const reviewCount = reviewCountCV?.type === ClarityType.UInt ? Number((reviewCountCV as any).value) : 0;

    return {
      totalRating,
      reviewCount,
      averageRating: reviewCount > 0 ? Math.round((totalRating / reviewCount) * 100) / 100 : 0,
    };
  } catch {
    return zero;
  }
}
