import type { RequestHandler } from "express";
import { loadPaymentConfig, assertPaymentConfig, NETWORK, USDT0_DECIMALS } from "./config.js";

// OKX Payment SDK (github.com/okx/payments). Export names verified against the
// installed packages: OKXFacilitatorClient from x402-core; x402ResourceServer,
// x402HTTPResourceServer, paymentMiddlewareFromHTTPServer from x402-express;
// ExactEvmScheme (the SERVER scheme, which implements parsePrice) from
// x402-evm/exact/server. Loaded via dynamic import so dev mode never touches them.

export interface PaymentLayer {
  middleware: RequestHandler;
  initialize: () => Promise<void>;
}

export async function createPaymentLayer(routeKeys: string[]): Promise<PaymentLayer> {
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
    syncSettle: true,
  });

  const resourceServer = new srv.x402ResourceServer(facilitatorClient).register(NETWORK, new evm.ExactEvmScheme());

  // Same accepts on every gated route. We gate both GET and POST /analyze because
  // OKX's x402-check (and buyer agents) probe GET, while our own callers POST.
  const accepts = {
    scheme: "exact",
    network: NETWORK,
    payTo: cfg.payTo,
    price: cfg.price,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    // USDT0 isn't in OKX's task-system token list, so advertise its decimals.
    extra: { decimals: USDT0_DECIMALS },
  };
  const routes = Object.fromEntries(routeKeys.map((k) => [k, { accepts }]));
  const httpServer = new srv.x402HTTPResourceServer(resourceServer, routes);

  // 4th arg false = disable the SDK's fire-and-forget facilitator sync (its
  // rejection is uncatchable). We run initialize() ourselves, guarded, in index.ts.
  return {
    middleware: srv.paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false),
    initialize: () => resourceServer.initialize(),
  };
}
