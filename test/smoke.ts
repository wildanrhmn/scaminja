import "dotenv/config";
import { analyze } from "../src/engine/analyze.js";

/**
 * Local end-to-end demo. Requires ANTHROPIC_API_KEY (or `ant auth login`).
 * Run:  npm run smoke
 *
 * These are the kinds of samples we'll show in the ≤90s X demo — one everyday
 * scam, one crypto scam, and one genuinely benign message to prove it doesn't
 * cry wolf.
 */
const SAMPLES: { label: string; text: string }[] = [
  {
    label: "SMS parcel phishing (everyday)",
    text: "ROYAL MAIL: Your parcel has a £1.99 unpaid shipping fee. Failure to pay within 24h will result in return to sender. Pay now: https://royalmail-redelivery.info/pay",
  },
  {
    label: "Crypto airdrop drainer (crypto)",
    text: "🎉 You are eligible for the OKB community airdrop (2,500 OKB). Connect your wallet to claim before it expires: https://okb-airdrop-claim.xyz — verify your seed phrase to receive tokens.",
  },
  {
    label: "Fake remote job offer (everyday)",
    text: "Hi! We reviewed your profile and want to offer you a remote data-entry role, $450/day, no interview. To onboard, please pay a $50 refundable equipment deposit via gift card and send the code.",
  },
  {
    label: "Benign message (should be SAFE / low risk)",
    text: "Hey, running 10 mins late for lunch — grab us a table and I'll be right there!",
  },
];

async function main() {
  for (const s of SAMPLES) {
    console.log(`\n─── ${s.label} ───`);
    try {
      const v = await analyze({ text: s.text });
      console.log(`${v.verdict.toUpperCase()}  (risk ${v.risk_score}, confidence ${v.confidence})`);
      console.log(`» ${v.title}`);
      console.log(`  ${v.summary}`);
      if (v.red_flags.length) {
        console.log("  red flags:");
        for (const f of v.red_flags) console.log(`   - [${f.severity}] ${f.label}: ${f.detail}`);
      }
      if (v.recommended_actions.length) console.log(`  do: ${v.recommended_actions.join(" | ")}`);
    } catch (e) {
      console.error("  ERROR:", e instanceof Error ? e.message : e);
    }
  }
}

main();
