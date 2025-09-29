// Utility cryptography helpers for signatures and canonical hashing
// NOTE: Comments in English as requested
import { sha256 } from './util.js';
import * as ed25519 from '@noble/ed25519';

// Canonical JSON stringify: stable key order
export function canonicalStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map((v) => canonicalStringify(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

// Compute a transaction digest from core fields
export function txDigest(txCore) {
  // Exclude signature from digest. txCore should NOT include signature.
  const canon = canonicalStringify(txCore);
  return sha256(canon);
}

// Verify Ed25519 signature (hex inputs)
export async function verifySignature({ signatureHex, messageHex, publicKeyHex }) {
  try {
    const sig = hexToBytes(signatureHex);
    const msg = hexToBytes(messageHex);
    const pub = hexToBytes(publicKeyHex);
    return await ed25519.verify(sig, msg, pub);
  } catch (_e) {
    return false;
  }
}

export function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.length % 2 !== 0) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
