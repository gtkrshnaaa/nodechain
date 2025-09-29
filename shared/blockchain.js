import { computeBlockHash, mineNonce, nowTs } from './util.js';
import { addBlock, getChain, getHeight, getMempool, clearMempool } from './db.js';

// Ensure genesis block exists if chain empty
export async function ensureGenesis(db) {
  const height = await getHeight(db);
  if (height > 0) return;
  const genesis = {
    index: 1,
    timestamp: nowTs(),
    prevHash: '0'.repeat(64),
    nonce: 0,
    txs: [{ id: 'genesis', from: 'system', to: 'system', content: 'genesis', timestamp: nowTs() }]
  };
  genesis.hash = computeBlockHash(genesis);
  await addBlock(db, genesis);
}

export async function mineBlock(db, difficulty = 4) {
  const chain = await getChain(db);
  const prev = chain[chain.length - 1];
  const mempool = await getMempool(db);
  if (mempool.length === 0) {
    return { mined: false, reason: 'mempool empty' };
  }
  const base = {
    index: prev.index + 1,
    timestamp: nowTs(),
    prevHash: prev.hash,
    txs: mempool
  };
  const { nonce, hash } = mineNonce(base, difficulty);
  const block = { ...base, nonce, hash };
  await addBlock(db, block);
  await clearMempool(db, mempool.map(t => t.id));
  return { mined: true, block };
}

export function isValidNewBlock(prevBlock, newBlock) {
  if (newBlock.index !== prevBlock.index + 1) return false;
  if (newBlock.prevHash !== prevBlock.hash) return false;
  const recomputed = computeBlockHash(newBlock);
  if (recomputed !== newBlock.hash) return false;
  if (!newBlock.hash.startsWith('0000')) return false;
  return true;
}
