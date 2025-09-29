# NodeChain (Fastify + SQLite)

Simulasi blockchain ringan (mirip thread) berbasis Node.js, Fastify, SQLite, dan Swagger.

## Fitur
- PoW sederhana (prefix 0000)
- Mempool transaksi ("thread/message")
- Mining block dari mempool
- Gossip P2P untuk block dan transaksi (tanpa entri point pusat)
- Anti-entropy sync periodik antar peer
- Transaksi bertanda tangan opsional (Ed25519)
- Fitur sosial: users, posts, replies, follows, likes, timeline, search (#hashtag)
- Swagger UI per node di `/docs`

## Struktur (tanpa pusat, per-node)
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

## Menjalankan
1. Install dependencies:
```bash
npm install
```
2. Jalankan node1 dan node2 di terminal terpisah:
```bash
npm run dev:node1
npm run dev:node2
```

Swagger UI:
- Node1: http://localhost:3001/docs
- Node2: http://localhost:3002/docs

## API ringkas (inti)
- GET `/health`
- GET `/chain`
- GET `/mempool`
- POST `/tx` { from, to, content } — akan di-gossip ke peers
- POST `/tx/signed` { id, from, to, content, timestamp, pubkey, signature }
- POST `/mine`
- GET `/peers`
- POST `/peers` { url }
- GET `/blocks?fromHeight=N`
- POST `/receive-block` (opsi kompatibilitas)
- POST `/sync`
- POST `/gossip/tx`
- POST `/gossip/block`

## API ringkas (sosial)
- POST `/users/register` { handle, displayName?, pubkey? }
- GET `/users/:handle`
- POST `/post` { author, text, tags? }
- POST `/reply` { author, text, parentId }
- POST `/follow` { follower, followee }
- POST `/like` { liker, postId }
- GET `/timeline/:handle` (limit?, offset?)
- GET `/user/:handle/posts` (limit?, offset?)
- GET `/search?q=` (mendukung `#hashtag`)

## Catatan
- Ini adalah simulasi edukasi, bukan untuk produksi.
- Tidak ada entri point pusat: setiap node self-contained dan setara.
- Database SQLite akan dibuat per node di jalur yang dikonfigurasi (lihat `nodeX/node.config.json`).
