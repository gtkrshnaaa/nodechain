import { request } from 'undici';

// Broadcast a block to peers via HTTP
export async function broadcastBlock(peers, block) {
  const results = await Promise.allSettled(
    peers.map(async (p) => {
      const url = `${p}/receive-block`;
      try {
        await request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(block)
        });
        return { peer: p, ok: true };
      } catch (e) {
        return { peer: p, ok: false, error: e.message };
      }
    })
  );
  return results;
}

export async function fetchBlocksFrom(peer, fromHeight) {
  const url = `${peer}/blocks?fromHeight=${fromHeight}`;
  const res = await request(url, { method: 'GET' });
  if (res.statusCode !== 200) throw new Error(`Peer ${peer} returned ${res.statusCode}`);
  const data = await res.body.json();
  return data.blocks;
}
