import "dotenv/config";
import path from "node:path";
import express from "express";
import { analyze } from "./engine/analyze.js";
import { validateInput, ValidationError } from "./security/validate.js";
import { rateLimiter, dailyBudget } from "./security/rateLimit.js";
import { createPaymentLayer } from "./payment/x402.js";
import { isBreakerOpen, tripBreaker, closeBreaker, isServiceUnavailableError } from "./breaker.js";
import { analyzeRepo } from "./repo/analyze.js";
import { RepoError } from "./repo/fetch.js";

const PORT = Number(process.env.PORT ?? 8080);
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";
const ROUTE_KEYS = ["POST /x402/analyze", "GET /x402/analyze", "POST /x402/repo-analyze", "GET /x402/repo-analyze"];
const GATED_PATHS = new Set(["/x402/analyze", "/try", "/x402/repo-analyze", "/repo-try"]);

// On any engine failure we return CAUTION, never a false "safe".
function cautionBody(summary: string) {
  return {
    verdict: "caution",
    confidence: 0,
    risk_score: 50,
    input_type: "other",
    title: "Could not complete the check",
    summary,
    red_flags: [] as unknown[],
    recommended_actions: ["Do not act on the content until you can verify it independently."],
    indicators: { urls: [], addresses: [], emails: [], phone_numbers: [] },
    disclaimer: "Risk guidance, not a guarantee. Verify independently.",
  };
}

async function main() {
  const app = express();
  app.set("trust proxy", 1); // behind nginx — makes req.ip the real client
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(express.json({ limit: "14mb" }));

  // The website is the pre-rendered React/Vite build (web/dist). Static assets —
  // hashed JS/CSS bundles, images, /demo/*, robots.txt, sitemap.xml — are served
  // straight from there; index:false so "/" falls through to the content-negotiated
  // handler below (browsers get HTML, agents get the JSON manifest).
  const WEB_DIST = path.resolve("web/dist");
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));

  // Reject before the payment gate when the engine can't serve, so buyers are
  // never charged for a check we can't deliver.
  app.use((req, res, next) => {
    if (GATED_PATHS.has(req.path) && (req.method === "POST" || req.method === "GET") && isBreakerOpen()) {
      return res
        .status(503)
        .set("Retry-After", "120")
        .json({ error: "Scaminja is temporarily unavailable. No payment was taken — please try again shortly." });
    }
    next();
  });

  let paymentLayer: Awaited<ReturnType<typeof createPaymentLayer>> | null = null;
  if (PAYMENTS_ENABLED) {
    paymentLayer = await createPaymentLayer(ROUTE_KEYS);
    app.use(paymentLayer.middleware);
  }

  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 600_000);

  // Paid x402 callers cover their own Claude cost, so they get a lenient limiter.
  const paidLimiter = rateLimiter({
    windowMs,
    maxPerIp: Number(process.env.RATE_LIMIT_MAX ?? 20),
    maxGlobal: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 200),
  });

  // The free website demo spends OUR balance, so it gets a tighter per-IP/global
  // limiter plus a hard daily budget (kill-switch) on top.
  const demoLimiter = rateLimiter({
    windowMs,
    maxPerIp: Number(process.env.DEMO_RATE_MAX ?? 5),
    maxGlobal: Number(process.env.DEMO_RATE_GLOBAL_MAX ?? 40),
  });
  const demoBudget = dailyBudget({ max: Number(process.env.DAILY_FREE_MAX ?? 500) });

  // Browsers get the landing page; agents/curl get the JSON manifest.
  app.get("/", (req, res) => {
    if ((req.headers.accept ?? "").includes("text/html")) {
      return res.sendFile(path.join(WEB_DIST, "index.html"));
    }
    res.json({
      name: "Scaminja",
      tagline: "One call: is this message, link, email, wallet, screenshot, PDF, or GitHub repo safe? Instant, evidence-backed Safe / Caution / Scam verdict.",
      service: "Scaminja Safety Check",
      endpoint: "POST /x402/analyze",
      input: {
        text: "string — a message/link/email/wallet, OR a GitHub repo URL, OR a package.json (auto-detected)",
        files: "[{kind:'image'|'pdf', base64, mediaType}] (optional) — screenshots / PDFs",
        typeHint: "string (optional)",
      },
      price: `${process.env.PRICE ?? "$0.02"} per call`,
      network: "X Layer (eip155:196)",
      payments: PAYMENTS_ENABLED ? "x402 (A2MCP)" : "open (dev mode)",
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // A bare GitHub repo URL, or a package.json, routes to the supply-chain engine;
  // everything else (message/link/email/wallet/screenshot/PDF) to the scam engine.
  const asRepo = (src: Record<string, unknown>): { repoUrl?: string; packageJson?: string } | null => {
    const repoUrl = typeof src?.repoUrl === "string" ? src.repoUrl.trim() : "";
    const packageJson = typeof src?.packageJson === "string" ? src.packageJson : "";
    if (repoUrl || packageJson) return { repoUrl, packageJson };
    const text = typeof src?.text === "string" ? src.text.trim() : "";
    if (!text) return null;
    if (/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?(?:\/tree\/[\w.\-/]+)?\/?$/i.test(text)) return { repoUrl: text };
    if (text.startsWith("{")) {
      try {
        const o = JSON.parse(text);
        if (o && typeof o === "object" && (o.dependencies || o.devDependencies || o.scripts || o.name)) return { packageJson: text };
      } catch { /* not JSON → treat as scam text */ }
    }
    return null;
  };

  // One universal endpoint: dispatches to the repo or the scam engine.
  const check = async (req: express.Request, res: express.Response) => {
    const start = Date.now();
    const src = (req.method === "GET" ? req.query : req.body) as Record<string, unknown>;

    const repo = asRepo(src);
    if (repo) {
      if ((repo.packageJson ?? "").length > 300_000) return res.status(400).json({ error: "`packageJson` is too large." });
      try {
        const verdict = await analyzeRepo(repo);
        closeBreaker();
        console.log(`[repo] ${verdict.verdict} risk=${verdict.risk_score} ev=${verdict.evidence.length} ${Date.now() - start}ms`);
        return res.json(verdict);
      } catch (err) {
        if (err instanceof RepoError) return res.json(cautionBody(err.message));
        console.error(`[repo] failed after ${Date.now() - start}ms:`, err instanceof Error ? err.message : err);
        if (isServiceUnavailableError(err)) tripBreaker(err instanceof Error ? err.message : "engine unavailable");
        return res.status(503).json(cautionBody("We couldn't complete the check right now. Treat this as unverified and try again shortly."));
      }
    }

    let input;
    try {
      input = validateInput(src);
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
      throw e;
    }
    try {
      const verdict = await analyze(input);
      closeBreaker();
      console.log(`[analyze] ${verdict.verdict} risk=${verdict.risk_score} ev=${verdict.evidence.length} ${Date.now() - start}ms`);
      res.json(verdict);
    } catch (err) {
      console.error(`[analyze] failed after ${Date.now() - start}ms:`, err instanceof Error ? err.message : err);
      if (isServiceUnavailableError(err)) tripBreaker(err instanceof Error ? err.message : "engine unavailable");
      res.status(503).json(cautionBody("We couldn't complete the check right now. Treat this as unverified and try again shortly."));
    }
  };

  app.post("/x402/analyze", paidLimiter, check); // paid (x402-gated) — the one A2MCP endpoint
  app.get("/x402/analyze", paidLimiter, check); // paid (x402-gated) — GET probe / query-string callers
  app.post("/try", demoLimiter, demoBudget, check); // free, rate-limited + daily budget — for the website
  app.post("/x402/repo-analyze", paidLimiter, check); // paid alias (unlisted) — explicit repo route
  app.get("/x402/repo-analyze", paidLimiter, check); // paid alias — GET probe
  app.post("/repo-try", demoLimiter, demoBudget, check); // free alias

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Payload too large." });
    console.error("[server] error:", err?.message ?? err);
    res.status(500).json({ error: "Internal error." });
  });

  // A stray async rejection (e.g. a transient facilitator hiccup) shouldn't kill
  // the process — log and stay up; pm2 handles genuine fatal exits.
  process.on("unhandledRejection", (reason) => {
    console.error("[server] unhandledRejection:", reason instanceof Error ? reason.message : reason);
  });

  const server = app.listen(PORT, async () => {
    if (paymentLayer) {
      try {
        await paymentLayer.initialize();
        console.log("[payments] facilitator initialized");
      } catch (e) {
        console.error("[payments] facilitator init failed:", e instanceof Error ? e.message : e);
      }
    }
    console.log(`Scaminja on :${PORT}  (payments: ${PAYMENTS_ENABLED ? "on / x402" : "off / dev"})`);
  });

  const shutdown = (sig: string) => {
    console.log(`[server] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start Scaminja:", err);
  process.exit(1);
});
