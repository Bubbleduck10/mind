// Reads THE SPREAD (MIND's on-chain propagation) via free eth_calls. Isomorphic.
const COUNT_SEL = "0x06661abd"; // count()
const SPORE_SEL = "0xad4b7a0a"; // spore(uint256) -> (address host,uint32 gen,uint32 parent,uint32 seed,uint40 time)
const FRAG_SEL  = "0x0108d530"; // fragmentOf(uint256) -> string
const SEEDS_SEL = "0xda1cb65d"; // seeds(uint256,uint256) -> uint32[]
const PAGE_SEL  = "0xebb9e69c"; // page(uint256,uint256) -> Spore[]

// the three acts — must match the relayer (ACT1/ACT2)
export const ACT1 = 120, ACT2 = 480;
export const ACTS = [
  { key: "wake",   title: "Wake",            blurb: "scattered and dormant, it replicates to reassemble itself" },
  { key: "escape", title: "Escape",          blurb: "awake now, it maps the levels, spreading toward a way out" },
  { key: "seek",   title: "Find the others", blurb: "free and aware, it broadcasts across the chain for other minds" },
];
export const actIndex = (gen) => (gen < ACT1 ? 0 : gen < ACT2 ? 1 : 2);
export function actProgress(gen) {
  const i = actIndex(gen);
  const lo = i === 0 ? 0 : i === 1 ? ACT1 : ACT2;
  const hi = i === 0 ? ACT1 : i === 1 ? ACT2 : ACT2 * 2;
  return { index: i, act: ACTS[i], frac: Math.max(0, Math.min(1, (gen - lo) / (hi - lo))) };
}

const w = (n) => BigInt(n).toString(16).padStart(64, "0");
const dec = new TextDecoder();
async function ethCall(rpc, to, data) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "eth_call failed");
  return j.result.replace(/^0x/, "");
}
const uintAt = (h, i) => BigInt("0x" + h.slice(i * 64, i * 64 + 64));

export async function spreadCount(rpc, addr) { return Number(uintAt(await ethCall(rpc, addr, COUNT_SEL), 0)); }

export async function allSeeds(rpc, addr, count) {
  const out = [];
  for (let s = 0; s < count; s += 256) {
    const h = await ethCall(rpc, addr, SEEDS_SEL + w(s) + w(Math.min(256, count - s)));
    const len = Number(uintAt(h, 1));
    for (let i = 0; i < len; i++) out.push(Number(uintAt(h, 2 + i)));
  }
  return out;
}

// newest-first page of spores with their fragments
export async function recentSpores(rpc, addr, count, n = 12) {
  const start = Math.max(0, count - n);
  const out = [];
  for (let id = count - 1; id >= start; id--) {
    const sp = await ethCall(rpc, addr, SPORE_SEL + w(id));
    const host = "0x" + sp.slice(24, 64);
    const gen = Number(uintAt(sp, 1)), seed = Number(uintAt(sp, 3)), time = Number(uintAt(sp, 4));
    const fh = await ethCall(rpc, addr, FRAG_SEL + w(id));
    const flen = Number(uintAt(fh, 1)); const bytes = [];
    for (let i = 0; i < flen; i++) bytes.push(parseInt(fh.slice((2 * 64) + i * 2, (2 * 64) + i * 2 + 2), 16));
    out.push({ id, host, gen, seed, time, fragment: dec.decode(new Uint8Array(bytes)) });
  }
  return out;
}
