import { TXK } from './types.js';
import { upsertUser, insertPost, upsertFollow, upsertLike } from './db.js';

// Parse hashtags from text -> array of lowercase tags
function extractTags(text) {
  if (!text) return [];
  const tags = new Set();
  const re = /(^|\s)#([a-zA-Z0-9_]{1,64})/g;
  let m;
  while ((m = re.exec(text))) {
    tags.add(m[2].toLowerCase());
  }
  return Array.from(tags);
}

// Apply one tx into social projection tables
async function applyTx(db, tx, blockIndex) {
  // tx.content can be plain text (legacy) or JSON string {kind, author, payload}
  let parsed;
  try { parsed = JSON.parse(tx.content); } catch { parsed = null; }

  if (!parsed) {
    // Legacy: treat as a POST by sender to recipient/thread
    const id = tx.id;
    const author = tx.from;
    const text = tx.content;
    const tags = extractTags(text);
    await upsertUser(db, { handle: author, displayName: author, createdAt: tx.timestamp });
    await insertPost(db, { id, author, text, tags, parentId: null, timestamp: tx.timestamp, blockIndex });
    return;
  }

  const kind = parsed.kind;
  const author = parsed.author || tx.from;
  const payload = parsed.payload || {};

  switch (kind) {
    case TXK.USER_REGISTER: {
      await upsertUser(db, {
        handle: author,
        displayName: payload.displayName || author,
        pubkey: payload.pubkey || null,
        createdAt: tx.timestamp,
      });
      break;
    }
    case TXK.POST: {
      const id = tx.id;
      const text = payload.text || '';
      const tags = Array.isArray(payload.tags) ? payload.tags : extractTags(text);
      const parentId = payload.parentId || null;
      await upsertUser(db, { handle: author, displayName: author });
      await insertPost(db, { id, author, text, tags, parentId, timestamp: tx.timestamp, blockIndex });
      break;
    }
    case TXK.FOLLOW: {
      const follower = author;
      const followee = payload.followee;
      if (followee && follower) {
        await upsertUser(db, { handle: follower, displayName: follower });
        await upsertUser(db, { handle: followee, displayName: followee });
        await upsertFollow(db, { follower, followee, timestamp: tx.timestamp, blockIndex });
      }
      break;
    }
    case TXK.LIKE: {
      const liker = author;
      const postId = payload.postId;
      if (postId && liker) {
        await upsertUser(db, { handle: liker, displayName: liker });
        await upsertLike(db, { postId, liker, timestamp: tx.timestamp, blockIndex });
      }
      break;
    }
    default: {
      // Unknown kind: ignore
      break;
    }
  }
}

export async function applyBlock(db, block) {
  const idx = block.index;
  for (const tx of block.txs || []) {
    await applyTx(db, tx, idx);
  }
}

export async function backfillChain(db, chain) {
  for (const b of chain) {
    await applyBlock(db, b);
  }
}
