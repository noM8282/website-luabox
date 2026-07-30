import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

// Trust reverse proxy so req.secure works and cookies are set correctly
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

let store: session.Store;
if (process.env.DATABASE_URL) {
  const PgStore = connectPgSimple(session);
  store = new PgStore({
    pool,
    tableName: "sessions",
  });
} else {
  store = new session.MemoryStore();
}

app.use(
  session({
    store,
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: "auto",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: "lax",
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", router);

// Serve Dashboard frontend — resolved relative to this file so it works
// regardless of the working directory pnpm uses when launching the server.
const dashboardDir = path.resolve(__dirname, "../../dashboard");

if (process.env.NODE_ENV !== "production" && fs.existsSync(path.resolve(dashboardDir, "vite.config.ts"))) {
  try {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: dashboardDir,
    });
    app.use(vite.middlewares);
  } catch (err) {
    logger.warn({ err }, "Failed to initialize Vite server, relying on static serve");
  }
} else {
  function getDistPath(): string | undefined {
    const possibleDistPaths = [
      path.resolve(process.cwd(), "artifacts/dashboard/dist/public"),
      path.resolve(process.cwd(), "dist/public"),
      path.resolve(__dirname, "../../dashboard/dist/public"),
      path.resolve(__dirname, "../dashboard/dist/public"),
      path.resolve(__dirname, "./public"),
    ];
    return possibleDistPaths.find((p) => fs.existsSync(p));
  }

  const distPath = getDistPath();
  if (distPath) {
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        return next();
      }
      const htmlFile = path.join(distPath, "index.html");
      if (fs.existsSync(htmlFile)) {
        return res.sendFile(htmlFile);
      }
      next();
    });
  }
}

export default app;
