import { sha256Hex } from "./sha256.ts";

export interface MintedHubKey {
  /** The key itself. Shown or returned exactly once, never stored. */
  fullKey: string;
  /** The first twelve characters, kept so a person can tell their keys apart. */
  keyPrefix: string;
  /** What is stored, and what `lookupHubKey` compares against. */
  keyHash: string;
}

/**
 * The one way a Hub API key (mnr_ + 48 hex characters) is made.
 *
 * Settings, API Keys and the "connect your hub" flow both call this, so a key
 * made by either is looked up, prefixed and hashed the same way.
 */
export async function mintHubKey(): Promise<MintedHubKey> {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const hexKey = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const fullKey = `mnr_${hexKey}`;
  return {
    fullKey,
    keyPrefix: fullKey.slice(0, 12),
    keyHash: await sha256Hex(fullKey),
  };
}
