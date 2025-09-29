# NodeChain — Decentralized Blockchain Backend (Fastify + SQLite)

A real backend for a Twitter/X-like social platform built on a decentralized blockchain. Each node is self-contained, stores data in SQLite, exposes the same APIs, and communicates with peers via gossip and periodic anti-entropy sync.

## Features
- Simple Proof-of-Work (leading hash prefix `0000`).
- Transaction mempool (thread/message style) and block mining.
- P2P gossip for transactions and blocks (no central entry point).
- Periodic anti-entropy sync across peers.
- Optional Ed25519 signed transactions.
- Social features: users, posts, replies, follows, likes, timeline, search (#hashtags).
- Per-node Swagger UI at `/docs`.

## Architecture (per-node, no central services)
```
node1/
  index.js
  server.js
  util.js
  db.js
  blockchain.js
  p2p.js
  projection.js
  types.js
  crypto.js
  node.config.json
node2/
  index.js
  server.js
  util.js
  db.js
  blockchain.js
  p2p.js
  projection.js
  types.js
  crypto.js
  node.config.json
```

## Getting Started
1. Install dependencies:
```bash
npm install
```
2. Run two nodes in separate terminals:
```bash
npm run dev:node1
npm run dev:node2
```

Swagger UI:
- Node1: http://localhost:3001/docs
- Node2: http://localhost:3002/docs

## Core API
- GET `/health`
- GET `/chain`
- GET `/mempool`
- POST `/tx` { from, to, content } — gossiped to peers
- POST `/tx/signed` { id, from, to, content, timestamp, pubkey, signature }
- POST `/mine`
- GET `/peers`
- POST `/peers` { url }
- GET `/blocks?fromHeight=N`
- POST `/receive-block` (compatibility)
- POST `/sync`
- POST `/gossip/tx`
- POST `/gossip/block`

## Social API
- POST `/users/register` { handle, displayName?, pubkey? }
- GET `/users/:handle`
- POST `/post` { author, text, tags? }
- POST `/reply` { author, text, parentId }
- POST `/follow` { follower, followee }
- POST `/like` { liker, postId }
- GET `/timeline/:handle` (limit?, offset?)
- GET `/user/:handle/posts` (limit?, offset?)
- GET `/search?q=` (supports `#hashtag`)

## Notes
- This is a real decentralized backend: no central entry point, each node is equal and self-contained.
- Nodes communicate via HTTP gossip (transactions and blocks) and periodic anti-entropy sync.
- Each node stores its own SQLite database (see `nodeX/node.config.json`).
