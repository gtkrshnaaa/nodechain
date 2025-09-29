# NodeChain (Fastify + SQLite)

Simulasi blockchain ringan (mirip thread) berbasis Node.js, Fastify, SQLite, dan Swagger.

## Fitur
- Block + PoW sederhana (prefix 0000)
- Mempool transaksi ("thread message")
- Mining block dari mempool
- Sync sederhana antar peer (HTTP)
- Swagger UI di `/docs`

## Struktur
```
shared/
  util.js
  db.js
  blockchain.js
  p2p.js
src/
  createServer.js
node1/
  index.js
  node.config.json
node2/
  index.js
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

## API ringkas
- GET `/health`
- GET `/chain`
- GET `/mempool`
- POST `/tx` { from, to, content }
- POST `/mine`
- GET `/peers`
- POST `/peers` { url }
- GET `/blocks?fromHeight=N`
- POST `/receive-block` (internal peer)
- POST `/sync`

## Catatan
- Ini adalah simulasi edukasi, bukan untuk produksi.
- Database SQLite akan dibuat di `data/` percabang node.
