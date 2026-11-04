const store = new Map();
export default { multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]), multiSet: async (pairs) => { for (const [k, v] of pairs) store.set(k, v); }, removeItem: async (k) => { store.delete(k); }, getItem: async (k) => (store.has(k) ? store.get(k) : null), setItem: async (k, v) => { store.set(k, v); }, _store: store };
