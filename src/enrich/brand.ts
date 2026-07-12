import type { Evidence } from "./types.js";

// Commonly-impersonated brands → official registrable domains + name tokens.
const BRANDS: Array<{ name: string; domains: string[]; tokens: string[] }> = [
  { name: "PayPal", domains: ["paypal.com"], tokens: ["paypal"] },
  { name: "Apple", domains: ["apple.com", "icloud.com"], tokens: ["apple", "icloud"] },
  { name: "Amazon", domains: ["amazon.com"], tokens: ["amazon"] },
  { name: "Microsoft", domains: ["microsoft.com", "outlook.com", "live.com"], tokens: ["microsoft"] },
  { name: "Google", domains: ["google.com"], tokens: ["google"] },
  { name: "Netflix", domains: ["netflix.com"], tokens: ["netflix"] },
  { name: "Royal Mail", domains: ["royalmail.com"], tokens: ["royalmail"] },
  { name: "DHL", domains: ["dhl.com"], tokens: ["dhlexpress"] },
  { name: "FedEx", domains: ["fedex.com"], tokens: ["fedex"] },
  { name: "USPS", domains: ["usps.com"], tokens: ["usps"] },
  { name: "HMRC", domains: ["gov.uk"], tokens: ["hmrc"] },
  { name: "Coinbase", domains: ["coinbase.com"], tokens: ["coinbase"] },
  { name: "Binance", domains: ["binance.com"], tokens: ["binance"] },
  { name: "OKX", domains: ["okx.com", "okx.ai"], tokens: ["okxwallet"] },
  { name: "MetaMask", domains: ["metamask.io"], tokens: ["metamask"] },
  { name: "Ledger", domains: ["ledger.com"], tokens: ["ledger"] },
  { name: "Trust Wallet", domains: ["trustwallet.com"], tokens: ["trustwallet"] },
  { name: "WhatsApp", domains: ["whatsapp.com"], tokens: ["whatsapp"] },
  { name: "Instagram", domains: ["instagram.com"], tokens: ["instagram"] },
  { name: "Facebook", domains: ["facebook.com"], tokens: ["facebook"] },
  { name: "Chase", domains: ["chase.com"], tokens: ["chasebank"] },
];

function registrable(host: string): string {
  const p = host.replace(/\.$/, "").split(".");
  return p.length <= 2 ? host : p.slice(-2).join(".");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Deterministic brand-impersonation / typosquat check for a domain. */
export function checkBrand(host: string): Evidence[] {
  const h = host.toLowerCase();
  const reg = registrable(h);
  const sld = reg.split(".")[0];

  for (const brand of BRANDS) {
    if (brand.domains.includes(reg)) return []; // it IS the official brand (or a real subdomain) — benign
    const brandSld = brand.domains[0].split(".")[0];

    // Typosquat: look-alike of the official name (paypa1, arnazon, g00gle) —
    // check the whole SLD and each hyphen-separated part (paypa1-secure → paypa1).
    const candidates = [sld, ...sld.split("-")].filter((c) => c.length >= 4);
    for (const cand of candidates) {
      const dist = levenshtein(cand, brandSld);
      if (cand !== brandSld && dist > 0 && dist <= 2 && Math.abs(cand.length - brandSld.length) <= 2) {
        return [{ claim: `Domain "${reg}" is a look-alike of ${brand.name} (${brand.domains[0]})`, source: "typosquat check", kind: "verified", severity: "high", subject: host }];
      }
    }
    // Impersonation: brand name as a whole label/word anywhere in the host
    // (bounded by start/end or a . / - separator) — avoids "applepie" false hits.
    for (const token of brand.tokens) {
      if (token.length >= 5 && new RegExp(`(^|[.-])${token}([.-]|$)`).test(h)) {
        return [{ claim: `Domain "${reg}" uses the ${brand.name} name but is not an official ${brand.name} domain`, source: "brand check", kind: "verified", severity: "medium", subject: host }];
      }
    }
  }
  return [];
}
