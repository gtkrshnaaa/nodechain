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

    // Social projection tables
    db.run(`CREATE TABLE IF NOT EXISTS users (
      handle TEXT PRIMARY KEY,
      displayName TEXT,
      pubkey TEXT,
      createdAt INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      tags TEXT, -- JSON array string
      parentId TEXT,
      timestamp INTEGER NOT NULL,
      blockIndex INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS follows (
      follower TEXT NOT NULL,
      followee TEXT NOT NULL,
      timestamp INTEGER,
      blockIndex INTEGER,
      PRIMARY KEY (follower, followee)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS likes (
      postId TEXT NOT NULL,
      liker TEXT NOT NULL,
      timestamp INTEGER,
      blockIndex INTEGER,
      PRIMARY KEY (postId, liker)
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

// --- Social helpers ---
export function upsertUser(db, { handle, displayName, pubkey, createdAt }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users(handle, displayName, pubkey, createdAt)
       VALUES(?,?,?,?)
       ON CONFLICT(handle) DO UPDATE SET displayName=excluded.displayName, pubkey=coalesce(excluded.pubkey, users.pubkey)`,
      [handle, displayName || handle, pubkey || null, createdAt || Date.now()],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getUser(db, handle) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE handle = ?', [handle], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

export function insertPost(db, { id, author, text, tags, parentId, timestamp, blockIndex }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO posts(id, author, text, tags, parentId, timestamp, blockIndex)
       VALUES(?,?,?,?,?,?,?)`,
      [id, author, text, JSON.stringify(tags || []), parentId || null, timestamp || Date.now(), blockIndex || null],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function upsertFollow(db, { follower, followee, timestamp, blockIndex }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO follows(follower, followee, timestamp, blockIndex) VALUES(?,?,?,?)`,
      [follower, followee, timestamp || Date.now(), blockIndex || null],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function upsertLike(db, { postId, liker, timestamp, blockIndex }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO likes(postId, liker, timestamp, blockIndex) VALUES(?,?,?,?)`,
      [postId, liker, timestamp || Date.now(), blockIndex || null],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export function getUserPosts(db, handle, { limit = 20, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM posts WHERE author = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [handle, limit, offset],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => ({ ...r, tags: safeParse(r.tags, []) })));
      }
    );
  });
}

export function getTimeline(db, handle, { limit = 20, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT p.* FROM posts p
       WHERE p.author = ? OR p.author IN (
         SELECT followee FROM follows WHERE follower = ?
       )
       ORDER BY p.timestamp DESC
       LIMIT ? OFFSET ?`,
      [handle, handle, limit, offset],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => ({ ...r, tags: safeParse(r.tags, []) })));
      }
    );
  });
}

export function searchPosts(db, query, { limit = 20, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const isTag = query.startsWith('#');
    if (isTag) {
      const tag = query.slice(1).toLowerCase();
      db.all(
        `SELECT * FROM posts WHERE lower(tags) LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        [`%"${tag}"%`, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map(r => ({ ...r, tags: safeParse(r.tags, []) })));
        }
      );
    } else {
      db.all(
        `SELECT * FROM posts WHERE text LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        [`%${query}%`, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map(r => ({ ...r, tags: safeParse(r.tags, []) })));
        }
      );
    }
  });
}

function safeParse(s, dflt) {
  try { return JSON.parse(s); } catch { return dflt; }
}
