import sqlite3 from 'sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// Open or create SQLite database and ensure schema
export function openDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  sqlite3.verbose();
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS blocks (
      height INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      prevHash TEXT,
      timestamp INTEGER NOT NULL,
      nonce INTEGER NOT NULL,
      txs TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mempool (
      id TEXT PRIMARY KEY,
      sender TEXT,
      recipient TEXT,
      content TEXT,
      timestamp INTEGER
    )`);
  });

  return db;
}

export function getChain(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM blocks ORDER BY height ASC', (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(r => ({
        index: r.height,
        hash: r.hash,
        prevHash: r.prevHash,
        timestamp: r.timestamp,
        nonce: r.nonce,
        txs: JSON.parse(r.txs)
      })));
    });
  });
}

export function getHeight(db) {
  return new Promise((resolve, reject) => {
    db.get('SELECT MAX(height) as h FROM blocks', (err, row) => {
      if (err) return reject(err);
      resolve(row && row.h ? row.h : 0);
    });
  });
}

export function getBlocksFrom(db, fromHeight) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM blocks WHERE height > ? ORDER BY height ASC', [fromHeight], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(r => ({
        index: r.height,
        hash: r.hash,
        prevHash: r.prevHash,
        timestamp: r.timestamp,
        nonce: r.nonce,
        txs: JSON.parse(r.txs)
      })));
    });
  });
}

export function addBlock(db, block) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO blocks(height, hash, prevHash, timestamp, nonce, txs) VALUES(?,?,?,?,?,?)',
      [block.index, block.hash, block.prevHash, block.timestamp, block.nonce, JSON.stringify(block.txs)],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function addTx(db, tx) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO mempool(id, sender, recipient, content, timestamp) VALUES(?,?,?,?,?)',
      [tx.id, tx.from, tx.to, tx.content, tx.timestamp],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getMempool(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM mempool ORDER BY timestamp ASC', (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(r => ({ id: r.id, from: r.sender, to: r.recipient, content: r.content, timestamp: r.timestamp })));
    });
  });
}

export function clearMempool(db, txIds) {
  return new Promise((resolve, reject) => {
    if (!txIds.length) return resolve();
    const placeholders = txIds.map(() => '?').join(',');
    db.run(`DELETE FROM mempool WHERE id IN (${placeholders})`, txIds, function (err) {
      if (err) return reject(err);
      resolve();
    });
  });
}
