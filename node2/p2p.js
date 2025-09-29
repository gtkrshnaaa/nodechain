import { request } from 'undici';

// NOTE: Comments are in English as requested

function randomSubset(arr, k) {
  if (k >= arr.length) return [...arr];
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

function makeEnvelope({ type, data, ttl, mid, sender }) {
  return { t: type, d: data, ttl, mid, sender };
}

export function isEnvelope(obj) {
  return obj && typeof obj === 'object' && 't' in obj && 'd' in obj;
}

async function gossipPost(peer, path, body) {
  const url = `${peer}${path}`;
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.statusCode >= 400) throw new Error(`POST ${url} -> ${res.statusCode}`);
}

export async function broadcastBlock(peers, block, { fanout = peers.length, ttl = 0, mid, sender } = {}) {
  const targets = randomSubset(peers, fanout);
  const payload = ttl > 0 ? makeEnvelope({ type: 'block', data: block, ttl, mid, sender }) : block;
  const path = '/gossip/block';
  const results = await Promise.allSettled(targets.map((p) => gossipPost(p, path, payload)));
  return results.map((r, i) => ({ peer: targets[i], ok: r.status === 'fulfilled', error: r.status === 'rejected' ? r.reason?.message : undefined }));
}

export async function broadcastTx(peers, tx, { fanout = peers.length, ttl = 0, mid, sender } = {}) {
  const targets = randomSubset(peers, fanout);
  const payload = ttl > 0 ? makeEnvelope({ type: 'tx', data: tx, ttl, mid, sender }) : tx;
  const path = '/gossip/tx';
  const results = await Promise.allSettled(targets.map((p) => gossipPost(p, path, payload)));
  return results.map((r, i) => ({ peer: targets[i], ok: r.status === 'fulfilled', error: r.status === 'rejected' ? r.reason?.message : undefined }));
}

export async function fetchBlocksFrom(peer, fromHeight) {
  const url = `${peer}/blocks?fromHeight=${fromHeight}`;
  const res = await request(url, { method: 'GET' });
  if (res.statusCode !== 200) throw new Error(`Peer ${peer} returned ${res.statusCode}`);
  const data = await res.body.json();
  return data.blocks;
}

// Peer exchange helpers
export async function fetchPeerList(peer) {
  const url = `${peer}/peers`;
  const res = await request(url);
  if (res.statusCode !== 200) return [];
  const data = await res.body.json();
  return data.peers || [];
}

export async function exchangePeers(peer, peersToShare) {
  const url = `${peer}/peers/exchange`;
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peers: peersToShare }),
  });
  if (res.statusCode !== 200) return [];
  const data = await res.body.json();
  return data.peers || [];
}
