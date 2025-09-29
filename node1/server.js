import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { openDatabase, addTx, getMempool, getBlocksFrom, getChain, addBlock, getUser, getUserPosts, getTimeline, searchPosts } from './db.js';
import { ensureGenesis, mineBlock, isValidNewBlock } from './blockchain.js';
import { broadcastBlock, fetchBlocksFrom, broadcastTx, isEnvelope, fetchPeerList, exchangePeers } from './p2p.js';
import crypto from 'node:crypto';
import { TXK, makeTx } from './types.js';
import { backfillChain, applyBlock } from './projection.js';
import { txDigest, verifySignature } from './crypto.js';

export async function createServer(config) {
  const app = Fastify({ logger: true });

  await app.register(swagger, {
    openapi: {
      info: { title: 'NodeChain API', version: '0.1.0' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const db = openDatabase(config.dbPath);
  await ensureGenesis(db);
  await backfillChain(db, await getChain(db));

  app.decorate('db', db);
  app.decorate('peers', new Set(config.peers || []));
  app.decorate('difficulty', config.difficulty || 4);
  app.decorate('seenTx', new Set());
  app.decorate('seenBlocks', new Set());
  app.decorate('seenMsgs', new Set()); // for gossip envelopes (mid)
  app.decorate('self', config.self || `http://localhost:${config.port}`);
  app.decorate('gossipFanout', config.gossipFanout || 2);
  app.decorate('gossipTTL', config.gossipTTL || 2);

  // anti-entropy sync loop
  const syncIntervalMs = config.syncIntervalMs || 10000;
  const interval = setInterval(async () => {
    try { await performSync(app); } catch {}
  }, syncIntervalMs);
  app.addHook('onClose', async () => clearInterval(interval));

  // periodic peer exchange to grow/refresh view
  const peerXIntervalMs = config.peerExchangeIntervalMs || 20000;
  const peerInterval = setInterval(async () => {
    for (const p of app.peers) {
      try {
        const theirs = await fetchPeerList(p);
        for (const x of theirs) if (x !== app.self) app.peers.add(x);
        const returned = await exchangePeers(p, [...app.peers]);
        for (const x of returned) if (x !== app.self) app.peers.add(x);
      } catch {}
    }
  }, peerXIntervalMs);
  app.addHook('onClose', async () => clearInterval(peerInterval));

  app.get('/health', {
    schema: { summary: 'Health check', response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } }
  }, async () => ({ ok: true }));

  app.get('/chain', {
    schema: { summary: 'Get full chain', response: { 200: { type: 'object', properties: { length: { type: 'number' }, chain: { type: 'array' } } } } }
  }, async () => {
    const chain = await getChain(db);
    return { length: chain.length, chain };
  });

  app.get('/mempool', {
    schema: { summary: 'Get mempool', response: { 200: { type: 'object', properties: { txs: { type: 'array' } } } } }
  }, async () => ({ txs: await getMempool(db) }));

  app.post('/tx', {
    schema: {
      summary: 'Add a transaction',
      body: {
        type: 'object',
        required: ['from', 'to', 'content'],
        properties: { from: { type: 'string' }, to: { type: 'string' }, content: { type: 'string' } }
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } }
    }
  }, async (req) => {
    const { from, to, content } = req.body;
    const id = crypto.randomUUID();
    const tx = { id, from, to, content, timestamp: Date.now() };
    await addTx(db, tx);
    app.seenTx.add(id);
    await broadcastTx([...app.peers], tx, { fanout: app.gossipFanout, ttl: app.gossipTTL, mid: id, sender: app.self });
    return { ok: true, id };
  });

  app.post('/tx/signed', {
    schema: {
      summary: 'Submit a signed transaction',
      body: {
        type: 'object',
        required: ['id','from','to','content','timestamp','pubkey','signature'],
        properties: {
          id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, content: { type: 'string' }, timestamp: { type: 'integer' },
          pubkey: { type: 'string' }, signature: { type: 'string' }
        }
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } }
    }
  }, async (req, reply) => {
    const tx = req.body;
    const core = { id: tx.id, from: tx.from, to: tx.to, content: tx.content, timestamp: tx.timestamp };
    const digestHex = txDigest(core);
    const ok = await verifySignature({ signatureHex: tx.signature, messageHex: digestHex, publicKeyHex: tx.pubkey });
    if (!ok) return reply.code(400).send({ ok: false, error: 'invalid signature' });
    await addTx(db, core);
    app.seenTx.add(core.id);
    await broadcastTx([...app.peers], core, { fanout: app.gossipFanout, ttl: app.gossipTTL, mid: core.id, sender: app.self });
    return { ok: true };
  });

  app.post('/mine', { schema: { summary: 'Mine a block from mempool', response: { 200: { type: 'object' } } } }, async () => {
    const result = await mineBlock(db, app.difficulty);
    if (result.mined) {
      await applyBlock(db, result.block);
      app.seenBlocks.add(result.block.hash);
      await broadcastBlock([...app.peers], result.block, { fanout: app.gossipFanout, ttl: app.gossipTTL, mid: result.block.hash, sender: app.self });
    }
    return result;
  });

  app.get('/peers', { schema: { summary: 'List peers', response: { 200: { type: 'object', properties: { peers: { type: 'array', items: { type: 'string' } } } } } } }, async () => ({ peers: [...app.peers] }));

  app.post('/peers', { schema: { summary: 'Add peer', body: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }, response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } } }, async (req) => {
    const { url } = req.body;
    app.peers.add(url);
    return { ok: true };
  });

  app.post('/peers/exchange', { schema: { summary: 'Peer exchange (return my peers and merge yours)', body: { type: 'object', properties: { peers: { type: 'array', items: { type: 'string' } } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const incoming = Array.isArray(req.body?.peers) ? req.body.peers : [];
    for (const p of incoming) if (p !== app.self) app.peers.add(p);
    return { ok: true, peers: [...app.peers] };
  });

  app.get('/blocks', { schema: { summary: 'Get blocks from height (peer sync)', querystring: { type: 'object', properties: { fromHeight: { type: 'integer', default: 0 } } }, response: { 200: { type: 'object', properties: { blocks: { type: 'array' } } } } } }, async (req) => {
    const fromHeight = Number(req.query.fromHeight || 0);
    const blocks = await getBlocksFrom(db, fromHeight);
    return { blocks };
  });

  app.post('/receive-block', { schema: { summary: 'Receive a new block from peer', body: { type: 'object' }, response: { 200: { type: 'object' } } } }, async (req, reply) => {
    const block = req.body;
    const chain = await getChain(db);
    const prev = chain[chain.length - 1];
    if (!isValidNewBlock(prev, block)) {
      return reply.code(400).send({ ok: false, error: 'invalid block' });
    }
    await addBlock(db, block);
    await applyBlock(db, block);
    app.seenBlocks.add(block.hash);
    return { ok: true };
  });

  app.post('/sync', { schema: { summary: 'Sync from peers', response: { 200: { type: 'object' } } } }, async () => {
    const height = chainHeight(await getChain(db));
    let applied = 0;
    for (const p of app.peers) {
      try {
        const blocks = await fetchBlocksFrom(p, height);
        for (const b of blocks) {
          const chain = await getChain(db);
          const prev = chain[chain.length - 1];
          if (isValidNewBlock(prev, b)) {
            await addBlock(db, b);
            await applyBlock(db, b);
            applied++;
          }
        }
      } catch {}
    }
    return { ok: true, applied };
  });

  // Gossip endpoints
  app.post('/gossip/tx', { schema: { summary: 'Receive gossiped transaction or envelope', body: { type: 'object' }, response: { 200: { type: 'object' } } } }, async (req, reply) => {
    const body = req.body;
    if (isEnvelope(body)) {
      const { d: tx, ttl, mid } = body;
      if (!tx || !tx.id) return reply.code(400).send({ ok: false, error: 'bad tx' });
      if (app.seenMsgs.has(mid)) return { ok: true, duplicate: true };
      await addTx(db, tx);
      app.seenMsgs.add(mid);
      app.seenTx.add(tx.id);
      if (ttl > 1) await broadcastTx([...app.peers], tx, { fanout: app.gossipFanout, ttl: ttl - 1, mid, sender: app.self });
      return { ok: true };
    } else {
      const tx = body;
      if (!tx || !tx.id) return reply.code(400).send({ ok: false, error: 'bad tx' });
      if (app.seenTx.has(tx.id)) return { ok: true, duplicate: true };
      await addTx(db, tx);
      app.seenTx.add(tx.id);
      await broadcastTx([...app.peers], tx, { fanout: app.gossipFanout, ttl: app.gossipTTL, mid: tx.id, sender: app.self });
      return { ok: true };
    }
  });

  app.post('/gossip/block', { schema: { summary: 'Receive gossiped block or envelope', body: { type: 'object' }, response: { 200: { type: 'object' } } } }, async (req, reply) => {
    const body = req.body;
    if (isEnvelope(body)) {
      const { d: block, ttl, mid } = body;
      if (!block || !block.hash) return reply.code(400).send({ ok: false, error: 'bad block' });
      if (app.seenMsgs.has(mid)) return { ok: true, duplicate: true };
      const chain = await getChain(db);
      const prev = chain[chain.length - 1];
      if (!isValidNewBlock(prev, block)) return reply.code(400).send({ ok: false, error: 'invalid block' });
      await addBlock(db, block);
      await applyBlock(db, block);
      app.seenMsgs.add(mid);
      app.seenBlocks.add(block.hash);
      if (ttl > 1) await broadcastBlock([...app.peers], block, { fanout: app.gossipFanout, ttl: ttl - 1, mid, sender: app.self });
      return { ok: true };
    } else {
      const block = body;
      if (!block || !block.hash) return reply.code(400).send({ ok: false, error: 'bad block' });
      if (app.seenBlocks.has(block.hash)) return { ok: true, duplicate: true };
      const chain = await getChain(db);
      const prev = chain[chain.length - 1];
      if (!isValidNewBlock(prev, block)) return reply.code(400).send({ ok: false, error: 'invalid block' });
      await addBlock(db, block);
      await applyBlock(db, block);
      app.seenBlocks.add(block.hash);
      await broadcastBlock([...app.peers], block, { fanout: app.gossipFanout, ttl: app.gossipTTL, mid: block.hash, sender: app.self });
      return { ok: true };
    }
  });

  app.get('/', { schema: { summary: 'Docs redirect' } }, async (req, reply) => { reply.redirect('/docs'); });

  // Social endpoints
  registerSocialRoutes(app);

  return app;
}

function chainHeight(chain) {
  return chain.length ? chain[chain.length - 1].index : 0;
}

function registerSocialRoutes(app) {
  const db = app.db;

  app.post('/users/register', { schema: { summary: 'Register a user handle', body: { type: 'object', required: ['handle'], properties: { handle: { type: 'string' }, displayName: { type: 'string' }, pubkey: { type: 'string' } } }, response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } } } }, async (req) => {
    const { handle, displayName, pubkey } = req.body;
    const id = crypto.randomUUID();
    const content = JSON.stringify(makeTx(TXK.USER_REGISTER, { displayName, pubkey }, handle));
    await addTx(db, { id, from: handle, to: 'users', content, timestamp: Date.now() });
    return { ok: true, id };
  });

  app.get('/users/:handle', { schema: { summary: 'Get user profile', response: { 200: { type: 'object' } } } }, async (req, reply) => {
    const { handle } = req.params;
    const user = await getUser(db, handle);
    if (!user) return reply.code(404).send({ ok: false, error: 'not found' });
    return { ok: true, user };
  });

  app.post('/post', { schema: { summary: 'Create a post', body: { type: 'object', required: ['author', 'text'], properties: { author: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { author, text, tags } = req.body;
    const id = crypto.randomUUID();
    const content = JSON.stringify(makeTx(TXK.POST, { text, tags }, author));
    await addTx(db, { id, from: author, to: 'posts', content, timestamp: Date.now() });
    return { ok: true, id };
  });

  app.post('/reply', { schema: { summary: 'Reply to a post', body: { type: 'object', required: ['author', 'text', 'parentId'], properties: { author: { type: 'string' }, text: { type: 'string' }, parentId: { type: 'string' } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { author, text, parentId } = req.body;
    const id = crypto.randomUUID();
    const content = JSON.stringify(makeTx(TXK.POST, { text, parentId }, author));
    await addTx(db, { id, from: author, to: 'posts', content, timestamp: Date.now() });
    return { ok: true, id };
  });

  app.post('/follow', { schema: { summary: 'Follow a user', body: { type: 'object', required: ['follower', 'followee'], properties: { follower: { type: 'string' }, followee: { type: 'string' } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { follower, followee } = req.body;
    const id = crypto.randomUUID();
    const content = JSON.stringify(makeTx(TXK.FOLLOW, { followee }, follower));
    await addTx(db, { id, from: follower, to: 'social', content, timestamp: Date.now() });
    return { ok: true, id };
  });

  app.post('/like', { schema: { summary: 'Like a post', body: { type: 'object', required: ['liker', 'postId'], properties: { liker: { type: 'string' }, postId: { type: 'string' } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { liker, postId } = req.body;
    const id = crypto.randomUUID();
    const content = JSON.stringify(makeTx(TXK.LIKE, { postId }, liker));
    await addTx(db, { id, from: liker, to: 'social', content, timestamp: Date.now() });
    return { ok: true, id };
  });

  app.get('/timeline/:handle', { schema: { summary: 'Get timeline feed', querystring: { type: 'object', properties: { limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { handle } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const posts = await getTimeline(db, handle, { limit, offset });
    return { ok: true, posts };
  });

  app.get('/user/:handle/posts', { schema: { summary: 'Get posts by user', querystring: { type: 'object', properties: { limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { handle } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const posts = await getUserPosts(db, handle, { limit, offset });
    return { ok: true, posts };
  });

  app.get('/search', { schema: { summary: 'Search posts (full-text-ish or by #tag)', querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } }, response: { 200: { type: 'object' } } } }, async (req) => {
    const { q, limit = 20, offset = 0 } = req.query;
    const posts = await searchPosts(db, q, { limit, offset });
    return { ok: true, posts };
  });
}

async function performSync(app) {
  const db = app.db;
  const height = chainHeight(await getChain(db));
  for (const p of app.peers) {
    try {
      const blocks = await fetchBlocksFrom(p, height);
      for (const b of blocks) {
        const chain = await getChain(db);
        const prev = chain[chain.length - 1];
        if (isValidNewBlock(prev, b)) {
          await addBlock(db, b);
          await applyBlock(db, b);
          app.seenBlocks.add(b.hash);
        }
      }
    } catch {}
  }
}
