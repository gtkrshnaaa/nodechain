// Transaction kinds for social features
export const TXK = {
  USER_REGISTER: 'user_register',
  POST: 'post',
  FOLLOW: 'follow',
  LIKE: 'like',
};

// Create a generic tx envelope stored in mempool.content as JSON string
export function makeTx(kind, payload, author) {
  return {
    kind,
    author, // handle string
    payload, // object depending on kind
  };
}
