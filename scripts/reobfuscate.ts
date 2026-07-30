/**
 * One-off script: re-obfuscate all scripts in the DB so they use
 * loadstring() instead of load() (Roblox Luau compatibility fix).
 */
import { db, scriptsTable } from "../lib/db/src/index.js";
import { isNotNull } from "drizzle-orm";

function obfuscateLua(code: string): string {
  if (!code.trim()) return code;
  const key = Math.floor(Math.random() * 90) + 10;
  const bytes = Array.from(Buffer.from(code, "utf8")).map((b) => (b + key) % 256);
  return [
    `-- [[ LuaBox Protected ]] --`,
    `local _k=${key}`,
    `local _b={${bytes.join(",")}}`,
    `local _s=""`,
    `for _i=1,#_b do`,
    `  local _v=_b[_i]-_k`,
    `  if _v<0 then _v=_v+256 end`,
    `  _s=_s..string.char(_v)`,
    `end`,
    `local _f,_e=loadstring(_s)`,
    `if _f then return _f() else error(_e) end`,
  ].join("\n");
}

const scripts = await db
  .select({ id: scriptsTable.id, content: scriptsTable.content })
  .from(scriptsTable)
  .where(isNotNull(scriptsTable.content));

console.log(`Re-obfuscating ${scripts.length} script(s)…`);

for (const script of scripts) {
  if (!script.content) continue;
  await db.update(scriptsTable)
    .set({ obfuscatedContent: obfuscateLua(script.content) })
    .where(scriptsTable.id.eq(script.id) as any);
  console.log(`  ✓ script ${script.id}`);
}

console.log("Done.");
process.exit(0);
