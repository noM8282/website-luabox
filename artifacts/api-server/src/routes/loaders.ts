import { Router } from "express";
import { db, scriptsTable, licensesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { obfuscateLua } from "../lib/obfuscate";

const router = Router();

function getBaseUrl(req: { protocol: string; headers: { host?: string } }): string {
  // LOADER_BASE_URL lets you point loaders at a custom domain (e.g. faulmor.site)
  if (process.env.LOADER_BASE_URL) return process.env.LOADER_BASE_URL.replace(/\/$/, "");
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

/**
 * Build the loader snippet shown in the dashboard.
 * Uses the POST /execute endpoint so HWID is captured on first run and
 * verified on every subsequent run — no key works on a second machine.
 */
export function buildLoaderSnippet(loaderUrl: string, key: string): string {
  // Strip the /lua path if present — execute is at the same base
  const base = loaderUrl.replace(/\/lua$/, "");
  return (
    `local _hs=game:GetService("HttpService")\n` +
    `local _r=_hs:RequestAsync({Url="${base}/execute",Method="POST",` +
    `Headers={["Content-Type"]="application/json"},` +
    `Body=_hs:JSONEncode({key="${key}",hwid=game:GetService("RbxAnalyticsService"):GetClientId()})})\n` +
    `if _r.Success then loadstring(_r.Body)() else error("[LuaBox] ".._r.Body,2) end`
  );
}

/**
 * GET /api/public/loaders/:loaderId/lua
 *
 * Without ?key=  → 400; the snippet must be executed with a key.
 * With ?key=KEY  → validates the key, then returns the obfuscated Lua source
 *                  as plain text so Roblox's loadstring() can execute it directly.
 */
router.get("/public/loaders/:loaderId/lua", async (req, res): Promise<void> => {
  const { loaderId } = req.params;
  // Accept both ?key= (new) and ?k= (legacy) so old links keep working
  const key =
    (typeof req.query.key === "string" ? req.query.key.trim() : null) ??
    (typeof req.query.k === "string" ? req.query.k.trim() : null);

  // ── Require a key ─────────────────────────────────────────────────────────
  if (!key) {
    res
      .status(400)
      .type("text/plain")
      .send('error("[LuaBox] Missing key. Use the loader snippet from your dashboard.", 2)');
    return;
  }

  try {
    // ── Validate script exists and is active ───────────────────────────────
    const [script] = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.loaderId, loaderId))
      .limit(1);

    if (!script) {
      res.status(404).type("text/plain").send('error("[LuaBox] Loader not found.", 2)');
      return;
    }

    if (script.status !== "active") {
      res.status(403).type("text/plain").send('error("[LuaBox] This script is currently disabled.", 2)');
      return;
    }

    // ── Validate key ───────────────────────────────────────────────────────
    const [license] = await db
      .select()
      .from(licensesTable)
      .where(and(eq(licensesTable.key, key), eq(licensesTable.scriptId, script.id)))
      .limit(1);

    if (!license || license.status !== "active") {
      res.status(403).type("text/plain").send('error("[LuaBox] Invalid or inactive key.", 2)');
      return;
    }

    if (license.expiresAt && license.expiresAt <= new Date()) {
      res.status(403).type("text/plain").send('error("[LuaBox] Key has expired.", 2)');
      return;
    }

    // ── Resolve obfuscated content (regenerate if missing) ─────────────────
    let obfContent = script.obfuscatedContent;
    if (!obfContent) {
      if (!script.content) {
        res.status(503).type("text/plain").send('error("[LuaBox] Script has no content yet. Add Lua code in your dashboard.", 2)');
        return;
      }
      obfContent = obfuscateLua(script.content);
      // Persist so next request is instant
      await db
        .update(scriptsTable)
        .set({ obfuscatedContent: obfContent })
        .where(eq(scriptsTable.id, script.id));
    }

    // ── Valid — return obfuscated Lua source ───────────────────────────────
    res.type("text/plain").send(obfContent);
  } catch (err) {
    logger.error({ err }, "Loader lua error");
    res.status(500).type("text/plain").send('error("[LuaBox] Internal server error.", 2)');
  }
});

/**
 * POST /api/public/loaders/:loaderId/execute
 * Validates the license key and returns the protected Lua script.
 */
router.post("/public/loaders/:loaderId/execute", async (req, res): Promise<void> => {
  const { loaderId } = req.params;

  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) {
    res.status(400).type("text/plain").send('error("[LuaBox] Missing key.",2)');
    return;
  }

  // HWID is optional — if provided, it is bound on first use and verified thereafter
  const hwid = typeof req.body?.hwid === "string" ? req.body.hwid.trim() || null : null;

  try {
    const [script] = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.loaderId, loaderId))
      .limit(1);

    if (!script) {
      res.status(404).type("text/plain").send('error("[LuaBox] Loader not found.",2)');
      return;
    }

    if (script.status !== "active") {
      res.status(403).type("text/plain").send('error("[LuaBox] This script is currently disabled.",2)');
      return;
    }

    const [license] = await db
      .select()
      .from(licensesTable)
      .where(and(eq(licensesTable.key, key), eq(licensesTable.scriptId, script.id)))
      .limit(1);

    if (!license) {
      res.status(403).type("text/plain").send('error("[LuaBox] Invalid or inactive key.",2)');
      return;
    }

    if (license.status !== "active") {
      res.status(403).type("text/plain").send('error("[LuaBox] Key is revoked or inactive.",2)');
      return;
    }

    if (license.expiresAt && license.expiresAt <= new Date()) {
      res.status(403).type("text/plain").send('error("[LuaBox] Key has expired.",2)');
      return;
    }

    // ── HWID verification ──────────────────────────────────────────────────
    if (hwid) {
      if (!license.hwid) {
        // First execution — bind this machine
        await db
          .update(licensesTable)
          .set({ hwid })
          .where(eq(licensesTable.id, license.id));
      } else if (license.hwid !== hwid) {
        // Wrong machine
        res
          .status(403)
          .type("text/plain")
          .send('error("[LuaBox] HWID mismatch. Ask the script owner to reset your HWID.",2)');
        return;
      }
    }

    // ── Resolve obfuscated content ─────────────────────────────────────────
    let obfContent = script.obfuscatedContent;
    if (!obfContent) {
      if (!script.content) {
        res.status(503).type("text/plain").send('error("[LuaBox] Script has no content yet.",2)');
        return;
      }
      obfContent = obfuscateLua(script.content);
      await db
        .update(scriptsTable)
        .set({ obfuscatedContent: obfContent })
        .where(eq(scriptsTable.id, script.id));
    }

    res.type("text/plain").send(obfContent);
  } catch (err) {
    logger.error({ err }, "Loader execute error");
    res.status(500).type("text/plain").send('error("[LuaBox] Internal server error.",2)');
  }
});

export default router;
