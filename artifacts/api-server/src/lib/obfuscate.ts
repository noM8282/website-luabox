import { randomBytes } from "crypto";

/**
 * Generates a random Lua-safe identifier (underscore prefix + random letters).
 */
function rname(len = 11): string {
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = randomBytes(len);
  return "_" + Array.from(buf, (b) => alpha[b % alpha.length]).join("");
}

function randInt(min: number, max: number): number {
  const range = max - min + 1;
  return min + (randomBytes(1)[0] % range);
}

/**
 * Emits Lua lines that compute `k` through a 3-step XOR chain.
 *
 *   stored = k XOR mask1 XOR mask2      ← only literal in the source
 *   v_mid  = bit32.bxor(stored, mask2)
 *   result = bit32.bxor(v_mid,  mask1)  ← equals k at runtime
 *
 * Extracting k requires knowing both masks AND recognising the pattern across
 * three separate randomly-named variables — much harder than a simple a+b.
 */
function xorKeyChain(
  k: number,
  lines: string[]
): string {
  const mask1 = randInt(10, 250);
  const mask2 = randInt(10, 250);
  const stored = k ^ mask1 ^ mask2;
  const vRaw = rname();
  const vMid = rname();
  const vKey = rname();
  lines.push(`local ${vRaw}=${stored}`);
  lines.push(`local ${vMid}=bit32.bxor(${vRaw},${mask2})`);
  lines.push(`local ${vKey}=bit32.bxor(${vMid},${mask1})`);
  return vKey;
}

/**
 * Emits a block of convincingly-structured junk variable declarations that
 * reference each other (so they can't be trivially dead-code-stripped) but
 * produce values that are never used in the real decode path.
 */
function junkBlock(lines: string[], count = 5): void {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = rname();
    names.push(v);
    if (i === 0) {
      lines.push(`local ${v}=${randInt(5, 200)}*${randInt(2, 9)}+${randInt(1, 50)}`);
    } else {
      // Reference an earlier junk var to look interdependent
      const prev = names[randInt(0, i - 1)];
      const op = ["+", "-", "*"][randInt(0, 2)];
      lines.push(`local ${v}=${prev}${op}${randInt(1, 30)}`);
    }
  }
  // Wipe junk at the end of the block (makes it look like anti-dump)
  lines.push(`${names.join(",")}=${names.map(() => "nil").join(",")}`);
}

/**
 * Multi-layer Lua obfuscator — 7 encoding passes + position-dependent layer.
 *
 * Encoding pipeline per byte b at position i (0-based):
 *   v = (b   + k1)   % 256
 *   v =  v  XOR k2
 *   v = (v   + k3)   % 256
 *   v =  v  XOR k4
 *   v = (v   + k5)   % 256
 *   v =  v  XOR k6
 *   v = (v   + ((i * kP) % 256)) % 256   ← position-dependent; breaks frequency analysis
 *
 * Defences:
 *  • Each of k1–k6 and kP is recovered at runtime via a 3-step XOR chain
 *    (stored literal is k XOR mask1 XOR mask2; two bxor calls reconstruct k).
 *  • Position-dependent final layer means identical plaintext bytes produce
 *    different ciphertext values at different offsets.
 *  • All stdlib refs (string.char, table.concat, loadstring, ipairs) are
 *    aliased to randomly-named locals so string-search tools can't find them.
 *  • Two junk blocks (scattered through the decoder) add noise for static analysis.
 *  • Keys, intermediates, source string, and byte table are all wiped before
 *    the decoded function executes (anti-dump).
 */
export function obfuscateLua(code: string): string {
  if (!code.trim()) return code;

  // ── Seven independent keys (range 28–227) ───────────────────────────────
  const [k1, k2, k3, k4, k5, k6, kP] = Array.from(randomBytes(7)).map(
    (b) => (b % 200) + 28
  );

  // ── Encode ────────────────────────────────────────────────────────────────
  const raw = Array.from(Buffer.from(code, "utf8"));
  const encoded = raw.map((b, i) => {
    let v = (b + k1) & 0xff;
    v = v ^ k2;
    v = (v + k3) & 0xff;
    v = v ^ k4;
    v = (v + k5) & 0xff;
    v = v ^ k6;
    v = (v + ((i * kP) & 0xff)) & 0xff;
    return v;
  });

  // ── Chunk the encoded bytes ────────────────────────────────────────────────
  const CHUNK_SIZE = 150;
  const chunks: number[][] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }

  // ── Randomised variable names for everything ───────────────────────────────
  const vStrLib    = rname(); // local alias for `string`
  const vStrChar   = rname(); // string.char
  const vTblConcat = rname(); // table.concat
  const vLoadStr   = rname(); // loadstring
  const vIpairs    = rname(); // ipairs

  const vChunks = rname();
  const vOut    = rname();
  const vPos    = rname();
  const vCh     = rname();
  const vByte   = rname();
  const vTmp    = rname();
  const vSrc    = rname();
  const vFn     = rname();
  const vErr    = rname();
  const vI      = rname(); // generic loop var

  const lines: string[] = [];

  // ── Stdlib aliasing (hides plain "loadstring" etc. from grep/search) ──────
  lines.push(`local ${vStrLib}=string`);
  lines.push(`local ${vStrChar}=${vStrLib}.char`);
  lines.push(`local ${vTblConcat}=table.concat`);
  lines.push(`local ${vLoadStr}=loadstring`);
  lines.push(`local ${vIpairs}=ipairs`);

  // ── Key reconstruction chains ─────────────────────────────────────────────
  const vK1 = xorKeyChain(k1, lines);
  const vK2 = xorKeyChain(k2, lines);
  // First junk block (looks like more key setup)
  junkBlock(lines, randInt(4, 7));
  const vK3 = xorKeyChain(k3, lines);
  const vK4 = xorKeyChain(k4, lines);
  const vK5 = xorKeyChain(k5, lines);
  // Second junk block
  junkBlock(lines, randInt(4, 6));
  const vK6 = xorKeyChain(k6, lines);
  const vKP = xorKeyChain(kP, lines);

  // ── Encoded byte chunks ────────────────────────────────────────────────────
  lines.push(`local ${vChunks}={`);
  chunks.forEach((ch, i) => {
    lines.push(`  {${ch.join(",")}}${i < chunks.length - 1 ? "," : ""}`);
  });
  lines.push(`}`);

  // ── Decode loop ────────────────────────────────────────────────────────────
  // Reverses all 7 layers. Position is tracked as (vPos - 1) for 0-based index.
  lines.push(`local ${vOut}={}`);
  lines.push(`local ${vPos}=0`);
  lines.push(`for ${vI},${vCh} in ${vIpairs}(${vChunks}) do`);
  lines.push(`  for _,${vByte} in ${vIpairs}(${vCh}) do`);
  // Reverse layer 7: subtract (pos * kP) % 256
  lines.push(`    local ${vTmp}=(${vByte}-(${vPos}*${vKP})%256)%256`);
  // Reverse layer 6: XOR k6
  lines.push(`    ${vTmp}=bit32.bxor(${vTmp},${vK6})`);
  // Reverse layer 5: subtract k5 mod 256
  lines.push(`    ${vTmp}=(${vTmp}-${vK5})%256`);
  // Reverse layer 4: XOR k4
  lines.push(`    ${vTmp}=bit32.bxor(${vTmp},${vK4})`);
  // Reverse layer 3: subtract k3 mod 256
  lines.push(`    ${vTmp}=(${vTmp}-${vK3})%256`);
  // Reverse layer 2: XOR k2
  lines.push(`    ${vTmp}=bit32.bxor(${vTmp},${vK2})`);
  // Reverse layer 1: subtract k1 mod 256
  lines.push(`    ${vTmp}=(${vTmp}-${vK1})%256`);
  lines.push(`    ${vPos}=${vPos}+1`);
  lines.push(`    ${vOut}[${vPos}]=${vStrChar}(${vTmp})`);
  lines.push(`  end`);
  lines.push(`end`);

  // ── Wipe all key variables (anti-dump) ────────────────────────────────────
  lines.push(
    `${vK1},${vK2},${vK3},${vK4},${vK5},${vK6},${vKP}=nil,nil,nil,nil,nil,nil,nil`
  );
  lines.push(`${vChunks}=nil`);

  // ── Build source string, wipe byte table ──────────────────────────────────
  lines.push(`local ${vSrc}=${vTblConcat}(${vOut})`);
  lines.push(`for ${vI}=1,${vPos} do ${vOut}[${vI}]=nil end`);
  lines.push(`${vOut},${vPos},${vTblConcat},${vStrLib},${vStrChar},${vIpairs}=nil,nil,nil,nil,nil,nil`);

  // ── Compile and execute ────────────────────────────────────────────────────
  lines.push(`local ${vFn},${vErr}=${vLoadStr}(${vSrc})`);
  lines.push(`${vSrc},${vLoadStr}=nil,nil`);
  lines.push(`if ${vFn} then return ${vFn}() else error(${vErr},2) end`);

  return lines.join("\n");
}
