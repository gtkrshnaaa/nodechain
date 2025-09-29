import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { openDatabase } from '../shared/db.js';
import { ensureGenesis, mineBlock, isValidNewBlock } from '../shared/blockchain.js';
import { addTx, getMempool, getBlocksFrom, getChain, addBlock } from '../shared/db.js';
import { broadcastBlock, fetchBlocksFrom } from '../shared/p2p.js';
import crypto from 'node:crypto';

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

  app.decorate('db', db);
  app.decorate('peers', new Set(config.peers || []));
  app.decorate('difficulty', config.difficulty || 4);

  app.get('/health', {
    schema: { summary: 'Health check', response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } }
  }, async () => ({ ok: true }));

  app.get('/chain', {
    schema: { summary: 'Get full chain', response: { 200: { type: 'object', properties: { length: { type: 'number' }, chain: { type: 'array' } } } } }
  }, async (req, reply) => {
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
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          content: { type: 'string' }
        }
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } }
    }
  }, async (req, reply) => {
    const { from, to, content } = req.body;
    const id = crypto.randomUUID();
    const tx = { id, from, to, content, timestamp: Date.now() };
    await addTx(db, tx);
    return { ok: true, id };
  });

  app.post('/mine', {
    schema: { summary: 'Mine a block from mempool', response: { 200: { type: 'object' } } }
  }, async () => {
    const result = await mineBlock(db, app.difficulty);
    if (result.mined) {
      await broadcastBlock([...app.peers], result.block);
    }
    return result;
  });

  app.get('/peers', {
    schema: { summary: 'List peers', response: { 200: { type: 'object', properties: { peers: { type: 'array', items: { type: 'string' } } } } } }
  }, async () => ({ peers: [...app.peers] }));

  app.post('/peers', {
    schema: { summary: 'Add peer', body: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }, response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } }
  }, async (req) => {
    const { url } = req.body;
    app.peers.add(url);
    return { ok: true };
  });

  app.get('/blocks', {
    schema: { summary: 'Get blocks from height (peer sync)', querystring: { type: 'object', properties: { fromHeight: { type: 'integer', default: 0 } } }, response: { 200: { type: 'object', properties: { blocks: { type: 'array' } } } } }
  }, async (req) => {
    const fromHeight = Number(req.query.fromHeight || 0);
    const blocks = await getBlocksFrom(db, fromHeight);
    return { blocks };
  });

  app.post('/receive-block', {
    schema: { summary: 'Receive a new block from peer', body: { type: 'object' }, response: { 200: { type: 'object' } } }
  }, async (req, reply) => {
    const block = req.body;
    const chain = await getChain(db);
    const prev = chain[chain.length - 1];
    if (!isValidNewBlock(prev, block)) {
      return reply.code(400).send({ ok: false, error: 'invalid block' });
    }
    await addBlock(db, block);
    return { ok: true };
  });

  app.post('/sync', {
    schema: { summary: 'Sync from peers', response: { 200: { type: 'object' } } }
  }, async () => {
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
            applied++;
          }
        }
      } catch (_e) {}
    }
    return { ok: true, applied };
  });

  app.get('/', { schema: { summary: 'Docs redirect' } }, async (req, reply) => {
    reply.redirect('/docs');
  });

  return app;
}

function chainHeight(chain) {
  return chain.length ? chain[chain.length - 1].index : 0;
}
