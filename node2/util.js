import crypto from 'node:crypto';

// Hash a JSON-serializable object using SHA-256
export function sha256(obj) {
  const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Create a block hash from its fields
export function computeBlockHash({ index, timestamp, prevHash, nonce, txs }) {
  return sha256({ index, timestamp, prevHash, nonce, txs });
}

// Simple proof of work: find nonce such that hash starts with prefix
export function mineNonce(blockBase, difficulty = 4) {
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = computeBlockHash({ ...blockBase, nonce });
    if (hash.startsWith(prefix)) {
      return { nonce, hash };
    }
    nonce++;
  }
}

export function nowTs() {
  return Date.now();
}

export function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
