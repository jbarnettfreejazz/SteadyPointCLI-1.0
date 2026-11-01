export const pushPacket = (x, y, z) => { (globalThis.__pkts = globalThis.__pkts || []).push([x, y, z]); };
