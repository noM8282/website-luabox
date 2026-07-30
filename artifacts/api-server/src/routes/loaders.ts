import { Router } from "express";
import { db, scriptsTable, licensesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

function getBaseUrl(req: { protocol: string; headers: { host?: string } }): string {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

function buildBootstrapLua(executeUrl: string, key: string | null): string {
  // When key is provided it is embedded directly; otherwise the script reads
  // the global script_key set by the user before executing the loader.
  const keyLine = key
    ? `local key = "${key}"`
    : `local key = (getgenv and getgenv().script_key) or _G.script_key or ""\n\nif key == "" then\n    error("[LuaBox] script_key is not set. Set it before executing the loader.", 2)\nend`;

  return `-- LuaBox Secure Loader
local HttpService = game:GetService("HttpService")

${keyLine}

local ok, result = pcall(function()
    return HttpService:RequestAsync({
        Url = "${executeUrl}",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = HttpService:JSONEncode({ key = key })
    })
end)

if not ok then
    error("[LuaBox] Network error: " .. tostring(result), 2)
end

if result.StatusCode ~= 200 then
    local errMsg = "[LuaBox] Access denied."
    pcall(function()
        local decoded = HttpService:JSONDecode(result.Body)
        if decoded and decoded.error then
            errMsg = "[LuaBox] " .. decoded.error
        end
    end)
    error(errMsg, 2)
end

loadstring(result.Body)()
`;
}

/**
 * GET /api/public/loaders/:loaderId/lua
 * GET /api/public/loaders/:loaderId/lua?k=<key>   ← personalized (key embedded)
 *
 * Without ?k=: returns a generic bootstrap that reads script_key from the
 * executor global — the user must set it before calling the loader.
 *
 * With ?k=<key>: validates the key immediately and returns a bootstrap with
 * the key baked in — the user just pastes one line into their executor.
 */
router.get("/public/loaders/:loaderId/lua", async (req, res): Promise<void> => {
  const { loaderId } = req.params;
  const embeddedKey = typeof req.query.k === "string" ? req.query.k.trim() : null;

  // ── Validate script exists and is active ─────────────────────────────────
  const [script] = await db
    .select({ id: scriptsTable.id, status: scriptsTable.status })
    .from(scriptsTable)
    .where(eq(scriptsTable.loaderId, loaderId))
    .limit(1);

  if (!script) {
    res.status(404).type("text/plain").send("-- Loader not found");
    return;
  }

  if (script.status !== "active") {
    res.status(403).type("text/plain").send('error("[LuaBox] This script is currently disabled.")');
    return;
  }

  // ── Personalized: validate the embedded key up front ─────────────────────
  if (embeddedKey) {
    const [license] = await db
      .select({ id: licensesTable.id, status: licensesTable.status, expiresAt: licensesTable.expiresAt })
      .from(licensesTable)
      .where(and(eq(licensesTable.key, embeddedKey), eq(licensesTable.scriptId, script.id)))
      .limit(1);

    if (!license || license.status !== "active") {
      res.status(403).type("text/plain").send('error("[LuaBox] Invalid or inactive key.", 2)');
      return;
    }

    if (license.expiresAt && license.expiresAt <= new Date()) {
      res.status(403).type("text/plain").send('error("[LuaBox] Key has expired.", 2)');
      return;
    }
  }

  // ── Return bootstrap Lua ──────────────────────────────────────────────────
  const baseUrl = getBaseUrl(req);
  const executeUrl = `${baseUrl}/api/public/loaders/${loaderId}/execute`;
  const lua = buildBootstrapLua(executeUrl, embeddedKey);

  res.type("text/plain").send(lua);
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
