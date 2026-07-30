import { randomBytes } from "crypto";

/**
 * Generates a random Lua-safe variable name (underscore prefix + random letters).
 */
function rname(len = 10): string {
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = randomBytes(len);
  return "_" + Array.from(buf, (b) => alpha[b % alpha.length]).join("");
}

/**
 * Multi-layer Lua obfuscator with anti-dump protection.
 *
 * Encoding pipeline (per byte b):
 *   step1 = (b + k1) % 256
 *   step2 = step1 XOR k2
 *   step3 = (step2 + k3) % 256
 *   step4 = step3 XOR k4
 *
 * Keys are NOT stored as plain number literals — each is expressed as the
 * result of a small arithmetic chain computed at runtime, making static
 * analysis much harder.
 *
 * Anti-dump: the decoded string is wiped (set to nil) immediately after
 * loadstring() consumes it, before the returned function runs.
 *
 * The byte array is split into chunks to avoid one enormous table literal.
 */
export function obfuscateLua(code: string): string {
  if (!code.trim()) return code;

  // ── Generate four independent keys ────────────────────────────────────────
  const [k1, k2, k3, k4] = Array.from(randomBytes(4)).map((b) => (b % 200) + 28); // 28–227

  // ── Encode ────────────────────────────────────────────────────────────────
  const raw = Array.from(Buffer.from(code, "utf8"));
  const encoded = raw.map((b) => {
    let v = (b + k1) % 256;
    v = v ^ k2;
    v = (v + k3) % 256;
    v = v ^ k4;
    return v;
  });

  // ── Split into chunks of 150 bytes ────────────────────────────────────────
  const CHUNK_SIZE = 150;
  const chunks: number[][] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }

  // ── Obfuscate key storage: each key = sum of two random parts ────────────
  function splitKey(k: number): [number, number] {
    const a = Math.floor(Math.random() * 20) + 5;
    return [a, k - a];
  }
  const [k1a, k1b] = splitKey(k1);
  const [k2a, k2b] = splitKey(k2);
  const [k3a, k3b] = splitKey(k3);
  const [k4a, k4b] = splitKey(k4);

  // ── Random variable names ─────────────────────────────────────────────────
  const vK1 = rname();
  const vK2 = rname();
  const vK3 = rname();
  const vK4 = rname();
  const vChunks = rname();
  const vOut = rname();
  const vN = rname();
  const vCh = rname();
  const vByte = rname();
  const vTmp = rname();
  const vSrc = rname();
  const vFn = rname();
  const vErr = rname();

  // ── Assemble the protected Lua ────────────────────────────────────────────
  const lines: string[] = [
    // Key definitions (computed, not plain literals)
    `local ${vK1}=${k1a}+${k1b}`,
    `local ${vK2}=${k2a}+${k2b}`,
    `local ${vK3}=${k3a}+${k3b}`,
    `local ${vK4}=${k4a}+${k4b}`,
    // Byte chunks
    `local ${vChunks}={`,
    ...chunks.map((ch, i) => `  {${ch.join(",")}}${i < chunks.length - 1 ? "," : ""}`),
    `}`,
    // Decode loop: reassemble and reverse the 4-layer encoding
    `local ${vOut}={}`,
    `local ${vN}=0`,
    `for _,${vCh} in ipairs(${vChunks}) do`,
    `  for _,${vByte} in ipairs(${vCh}) do`,
    `    ${vN}=${vN}+1`,
    // Reverse step4: XOR k4
    `    local ${vTmp}=bit32.bxor(${vByte},${vK4})`,
    // Reverse step3: subtract k3 mod 256
    `    ${vTmp}=(${vTmp}-${vK3})%256`,
    // Reverse step2: XOR k2
    `    ${vTmp}=bit32.bxor(${vTmp},${vK2})`,
    // Reverse step1: subtract k1 mod 256
    `    ${vTmp}=(${vTmp}-${vK1})%256`,
    `    ${vOut}[${vN}]=string.char(${vTmp})`,
    `  end`,
    `end`,
    // Wipe keys from memory (anti-dump: keys gone before execution)
    `${vK1},${vK2},${vK3},${vK4}=nil,nil,nil,nil`,
    // Build source string then wipe the char table
    `local ${vSrc}=table.concat(${vOut})`,
    `for _i=1,${vN} do ${vOut}[_i]=nil end`,
    `${vOut},${vN},${vChunks}=nil,nil,nil`,
    // Compile
    `local ${vFn},${vErr}=loadstring(${vSrc})`,
    // Anti-dump: wipe source string before the function runs
    `${vSrc}=nil`,
    `if ${vFn} then return ${vFn}() else error(${vErr},2) end`,
  ];

  return lines.join("\n");
}
