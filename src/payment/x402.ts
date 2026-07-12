import type { RequestHandler } from "express";
import { loadPaymentConfig, assertPaymentConfig, NETWORK } from "./config.js";

/**
 * Builds the OKX x402 payment layer for a single A2MCP route.
 *
 * Uses the official OKX Payment SDK (github.com/okx/payments). Export names
 * VERIFIED against the installed packages (2026-07-12):
 *   @okxweb3/x402-core    — OKXFacilitatorClient
 *   @okxweb3/x402-express — x402ResourceServer, x402HTTPResourceServer, paymentMiddlewareFromHTTPServer
 *   @okxweb3/x402-evm/exact/server — ExactEvmScheme (the SERVER scheme, which
 *       implements parsePrice; the top-level ExactEvmScheme is the CLIENT class)
 *
 * The SDK is loaded via dynamic import so dev mode (PAYMENTS_ENABLED=false)
 * runs without touching the OKX packages. Specifiers are cast to `string` so
 * the compiler treats them as opaque runtime imports.
 */

export interface PaymentLayer {
  /** Express middleware that enforces x402 on the configured route. */
  middleware: RequestHandler;
  /** MUST be awaited after app.listen(), before the first request. */
  initialize: () => Promise<void>;
}

export async function createPaymentLayer(routeKey: string): Promise<PaymentLayer> {
  const cfg = loadPaymentConfig();
  assertPaymentConfig(cfg);

  const core: any = await import(("@okxweb3/x402-core") as string);
  const evm: any = await import(("@okxweb3/x402-evm/exact/server") as string);
  const srv: any = await import(("@okxweb3/x402-express") as string);

  const facilitatorClient = new core.OKXFacilitatorClient({
    apiKey: cfg.okx.apiKey,
    secretKey: cfg.okx.secretKey,
    passphrase: cfg.okx.passphrase,
    ...(cfg.okx.baseUrl ? { baseUrl: cfg.okx.baseUrl } : {}),
    syncSettle: true, // confirm settlement on-chain before we deliver the verdict
  });

  const resourceServer = new srv.x402ResourceServer(facilitatorClient).register(
    NETWORK,
    new evm.ExactEvmScheme(),
  );

  const httpServer = new srv.x402HTTPResourceServer(resourceServer, {
    [routeKey]: {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: cfg.payTo,
        price: cfg.price, // e.g. "$0.05" — SDK converts to USDT0 atomic units
        maxTimeoutSeconds: cfg.maxTimeoutSeconds,
      },
    },
  });

  // 4th arg `syncFacilitatorOnStart=false`: disable the SDK's fire-and-forget
  // background facilitator sync (its rejection is uncatchable and can crash the
  // process). We run initialize() ourselves, guarded, from index.ts.
  return {
    middleware: srv.paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false),
    initialize: () => resourceServer.initialize(),
  };
}
