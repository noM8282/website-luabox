import { Router } from "express";
import { db, scriptsTable, licensesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

function getBaseUrl(req: { protocol: string; headers: { host?: string } }): string {
  // LOADER_BASE_URL lets you point loaders at a custom domain (e.g. faulmor.site)
  if (process.env.LOADER_BASE_URL) return process.env.LOADER_BASE_URL.replace(/\/$/, "");
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

/**
 * Build the two-line loader snippet shown to the user in the dashboard.
 * Format:
 *   script_key="KEY";
 *
 *   loadstring(game:HttpGet("BASE/api/public/loaders/LOADER_ID/lua?key=KEY"))()
 */
export function buildLoaderSnippet(loaderUrl: string, key: string): string {
  return `script_key="${key}";\n\nloadstring(game:HttpGet("${loaderUrl}?key=${key}"))()`;
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

    if (!script.obfuscatedContent) {
      res.status(503).type("text/plain").send('error("[LuaBox] Script content not available.", 2)');
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

    // ── Valid — return obfuscated Lua source ───────────────────────────────
    res.type("text/plain").send(script.obfuscatedContent);
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
    res.status(400).json({ error: "Missing or invalid key." });
    return;
  }

  try {
    const [script] = await db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.loaderId, loaderId))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Loader not found." });
      return;
    }

    if (script.status !== "active") {
      res.status(403).json({ error: "Script is disabled." });
      return;
    }

    if (!script.obfuscatedContent) {
      res.status(503).json({ error: "Script content not available." });
      return;
    }

    const [license] = await db
      .select()
      .from(licensesTable)
      .where(and(eq(licensesTable.key, key), eq(licensesTable.scriptId, script.id)))
      .limit(1);

    if (!license) {
      res.status(403).json({ error: "Invalid key." });
      return;
    }

    if (license.status !== "active") {
      res.status(403).json({ error: "Key is revoked or inactive." });
      return;
    }

    if (license.expiresAt && license.expiresAt <= new Date()) {
      res.status(403).json({ error: "Key has expired." });
      return;
    }

    // Valid — return the obfuscated Lua content
    res.type("text/plain").send(script.obfuscatedContent);
  } catch (err) {
    logger.error({ err }, "Loader execute error");
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
