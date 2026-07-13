import { analyze, type ScamVerdict } from "./analyze.js";
import { analyzeRepo } from "../repo/analyze.js";
import { validateInput } from "../security/validate.js";

export type RepoSource = { repoUrl?: string; packageJson?: string };

// A bare GitHub repo URL, or a package.json, routes to the supply-chain engine;
// everything else (message/link/email/wallet/screenshot/PDF) to the scam engine.
export function asRepo(src: Record<string, unknown>): RepoSource | null {
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
    } catch {
      /* not JSON → treat as scam text */
    }
  }
  return null;
}

// Route a raw input to the right engine and return the verdict (throws on failure).
// Shared by the request handler and the demo-cache generator so both route identically.
export async function dispatch(src: Record<string, unknown>): Promise<ScamVerdict> {
  const repo = asRepo(src);
  if (repo) return analyzeRepo(repo);
  return analyze(validateInput(src));
}
