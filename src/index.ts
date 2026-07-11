import "dotenv/config";
import express from "express";
import { analyze } from "./engine/analyze.js";
import { validateInput, ValidationError } from "./security/validate.js";
import { rateLimiter } from "./security/rateLimit.js";
import { createPaymentLayer } from "./payment/x402.js";

const PORT = Number(process.env.PORT ?? 8080);
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";
const ROUTE_KEY = "POST /analyze";

/** Fail-protective body: on any engine failure we return CAUTION, never a false "safe". */
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

  app.use(express.json({ limit: "9mb" }));

  // Human-facing demo card at /demo (machine manifest stays at /).
  app.use("/demo", express.static("public"));

  // Payment gate (only when enabled). When on, x402 runs before /analyze.
  let paymentLayer: Awaited<ReturnType<typeof createPaymentLayer>> | null = null;
  if (PAYMENTS_ENABLED) {
    paymentLayer = await createPaymentLayer(ROUTE_KEY);
    app.use(paymentLayer.middleware);
  }

  // Abuse protection — defends the Claude balance in open mode and stops floods.
  const limiter = rateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 600_000),
    maxPerIp: Number(process.env.RATE_LIMIT_MAX ?? 20),
    maxGlobal: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 100),
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "Scam Shield",
      tagline: "Paste any message, link, email, or wallet address — get an instant Safe / Caution / Scam verdict.",
      endpoint: "POST /analyze",
      input: { text: "string (optional)", imageBase64: "string (optional)", imageMediaType: "string", typeHint: "string (optional)" },
      price: `${process.env.PRICE ?? "$0.02"} per call`,
      network: "X Layer (eip155:196)",
      payments: PAYMENTS_ENABLED ? "x402 (A2MCP)" : "open (dev mode)",
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/analyze", limiter, async (req, res) => {
    const start = Date.now();

    let input;
    try {
      input = validateInput(req.body);
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
      throw e;
    }

    try {
      const verdict = await analyze(input);
      console.log(`[analyze] ${verdict.verdict} risk=${verdict.risk_score} ${Date.now() - start}ms`);
      res.json(verdict);
    } catch (err) {
      // Log full detail server-side; never leak internal errors (keys, credit
      // status, upstream messages) to the caller.
      console.error(`[analyze] failed after ${Date.now() - start}ms:`, err instanceof Error ? err.message : err);
      res.status(503).json(cautionBody("We couldn't complete the check right now. Treat this as unverified and try again shortly."));
    }
  });

  // Unknown routes → clean JSON 404.
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // Body/parse + fallback error handler → clean JSON, no stack traces to clients.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Payload too large." });
    console.error("[server] error:", err?.message ?? err);
    res.status(500).json({ error: "Internal error." });
  });

  // Never let a stray async rejection (e.g. a transient facilitator hiccup) kill
  // the process — log it and stay up. pm2 handles genuine fatal exits.
  process.on("unhandledRejection", (reason) => {
    console.error("[server] unhandledRejection:", reason instanceof Error ? reason.message : reason);
  });

  const server = app.listen(PORT, async () => {
    if (paymentLayer) {
      try {
        await paymentLayer.initialize(); // load supported payment kinds from the facilitator
        console.log("[payments] facilitator initialized");
      } catch (e) {
        // Keep serving (health/demo stay up); payments recover when the
        // facilitator is reachable again. Do not crash-loop.
        console.error("[payments] facilitator init failed:", e instanceof Error ? e.message : e);
      }
    }
    console.log(`Scam Shield on :${PORT}  (payments: ${PAYMENTS_ENABLED ? "on / x402" : "off / dev"})`);
  });

  const shutdown = (sig: string) => {
    console.log(`[server] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref(); // force-exit if connections linger
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start Scam Shield:", err);
  process.exit(1);
});
