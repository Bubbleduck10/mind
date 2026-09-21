// Reads THE BACKROOMS (on-chain memory) via free eth_calls. Isomorphic.
const ROOMS_SEL = "0x201e1da0"; // rooms() -> (bytes32[] ids, string[] names, uint256[] counts)
const PAGE_SEL  = "0x19b34e8f"; // page(bytes32,uint256,uint256) -> Line[]
const LC_SEL    = "0x59f35f07"; // lineCount(bytes32) -> uint256

const dec = new TextDecoder();
const b32 = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const w = (n) => BigInt(n).toString(16).padStart(64, "0");

async function ethCall(rpc, to, data) {
  let last;
  for (let a = 0; a < 4; a++) {                 // retry transient RPC errors (rate limits, blips)
    try {
      const r = await fetch(rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "eth_call failed");
      return j.result.replace(/^0x/, "");
    } catch (e) { last = e; await new Promise((s) => setTimeout(s, 300 * (a + 1))); }
  }
  throw last;
}
const uintAt = (h, byteOff) => BigInt("0x" + h.slice(byteOff * 2, byteOff * 2 + 64));
function strAt(h, byteOff) {                 // byteOff points at [len][data]
  const len = Number(uintAt(h, byteOff));
  const start = (byteOff + 32) * 2;
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(parseInt(h.slice(start + i * 2, start + i * 2 + 2), 16));
  return dec.decode(new Uint8Array(bytes));
}

export async function lineCount(rpc, addr, id) {
  return Number(uintAt(await ethCall(rpc, addr, LC_SEL + b32(id)), 0));
}

// Line[]: struct{ uint40 time, bool fromMind, bytes32 who, string text }
export async function readPage(rpc, addr, id, start, n) {
  const h = await ethCall(rpc, addr, PAGE_SEL + b32(id) + w(start) + w(n));
  const arrBase = Number(uintAt(h, 0));           // offset to array
  const len = Number(uintAt(h, arrBase));
  const ptrTable = arrBase + 32;
  const out = [];
  for (let i = 0; i < len; i++) {
    const elem = ptrTable + Number(uintAt(h, ptrTable + i * 32));
    const time = Number(uintAt(h, elem));
    const fromMind = uintAt(h, elem + 32) !== 0n;
    const who = "0x" + h.slice((elem + 64) * 2, (elem + 64) * 2 + 64);
    const text = strAt(h, elem + Number(uintAt(h, elem + 96)));
    out.push({ time, fromMind, who, text });
  }
  return out;
}

export async function listRooms(rpc, addr) {
  const h = await ethCall(rpc, addr, ROOMS_SEL);
  const oIds = Number(uintAt(h, 0)), oNames = Number(uintAt(h, 32)), oCounts = Number(uintAt(h, 64));
  const nIds = Number(uintAt(h, oIds));
  const ids = [];
  for (let i = 0; i < nIds; i++) ids.push("0x" + h.slice((oIds + 32 + i * 32) * 2, (oIds + 32 + i * 32) * 2 + 64));
  const nNames = Number(uintAt(h, oNames)); const nameTable = oNames + 32;
  const names = [];
  for (let i = 0; i < nNames; i++) names.push(strAt(h, nameTable + Number(uintAt(h, nameTable + i * 32))));
  const nCounts = Number(uintAt(h, oCounts));
  const counts = [];
  for (let i = 0; i < nCounts; i++) counts.push(Number(uintAt(h, oCounts + 32 + i * 32)));
  return ids.map((id, i) => ({ id, name: names[i], count: counts[i] }));
}

export async function roomId(name) {         // sha256(nameLower) — matches the sponsor
  const data = new TextEncoder().encode(name.toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
