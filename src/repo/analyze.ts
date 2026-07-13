import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Verdict } from "../engine/schema.js";
import { REPO_SYSTEM_PROMPT } from "./prompt.js";
import { loadManifest } from "./fetch.js";
import { INSTALL_HOOKS, OBFUSCATION, POPULAR, levenshtein } from "./data.js";
import type { Evidence } from "../enrich/types.js";
import type { ScamVerdict } from "../engine/analyze.js";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";
const TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS ?? 45_000);
const OSV_TIMEOUT = Number(process.env.REPO_TIMEOUT_MS ?? 8000);

let _client: Anthropic | null = null;
const getClient = () => (_client ??= new Anthropic());
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function allDeps(pkg: any): Record<string, string> {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.optionalDependencies ?? {}) };
}

function scriptSignals(pkg: any): Evidence[] {
  const scripts = pkg?.scripts ?? {};
  const out: Evidence[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (typeof cmd !== "string") continue;
    const isHook = INSTALL_HOOKS.includes(name);
    const dangerous = OBFUSCATION.find((re) => re.test(cmd));
    if (dangerous) {
      out.push({ claim: `Script "${name}" runs a high-risk command (fetch-and-execute / obfuscation): \`${cmd.slice(0, 120)}\``, source: "package.json", kind: "verified", severity: "high", subject: name, detail: cmd });
    } else if (isHook) {
      out.push({ claim: `Runs a "${name}" hook automatically on npm install: \`${cmd.slice(0, 120)}\``, source: "package.json", kind: "verified", severity: "medium", subject: name, detail: cmd });
    }
  }
  return out;
}

function depSourceSignals(pkg: any): Evidence[] {
  const out: Evidence[] = [];
  for (const [name, ver] of Object.entries(allDeps(pkg))) {
    if (typeof ver !== "string") continue;
    if (/^(git\+|git:|https?:|github:|file:|link:|\/\/)/i.test(ver) || /\.(tgz|tar\.gz)(\?|$)/i.test(ver)) {
      out.push({ claim: `Dependency "${name}" is pulled from a non-registry source (${ver.slice(0, 60)}) — bypasses npm's registry`, source: "package.json", kind: "verified", severity: "medium", subject: name, detail: ver });
    } else if (/^[\w.-]+\/[\w.-]+$/.test(ver)) {
      out.push({ claim: `Dependency "${name}" resolves to a raw GitHub repo (${ver}) rather than a published package`, source: "package.json", kind: "verified", severity: "low", subject: name, detail: ver });
    }
  }
  return out;
}

function typosquatSignals(pkg: any): Evidence[] {
  const out: Evidence[] = [];
  for (const name of Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) })) {
    if (POPULAR.has(name) || name.length < 4) continue;
    for (const pop of POPULAR) {
      if (Math.abs(pop.length - name.length) > 1) continue;
      if (levenshtein(name, pop) === 1) {
        out.push({ claim: `Dependency "${name}" is a look-alike of the popular package "${pop}" (possible typosquat)`, source: "typosquat check", kind: "verified", severity: "medium", subject: name });
        break;
      }
    }
  }
  return out;
}

async function registryLatest(name: string): Promise<string | null> {
  const url = "https://registry.npmjs.org/" + (name.startsWith("@") ? name.replace("/", "%2F") : name);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OSV_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "scaminja" } });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j?.["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Only report actual MALWARE (OSV "MAL-" advisories), queried against the resolved
// latest version, and skip well-known packages. Generic CVEs are npm-audit noise —
// a repo full of deps with old CVEs is normal and must NOT read as "malicious".
async function osvSignals(pkg: any): Promise<Evidence[]> {
  const registryDeps = Object.entries(allDeps(pkg))
    .filter(([n, v]) =>
      typeof v === "string" &&
      !/^(git\+|git:|https?:|github:|file:|link:|\/\/)/i.test(v) &&
      !POPULAR.has(n) &&
      !n.startsWith("@types/"),
    )
    .map(([n]) => n)
    .slice(0, 40);
  if (!registryDeps.length) return [];

  const out: Evidence[] = [];
  const resolved = await Promise.all(registryDeps.map(async (name) => ({ name, version: await registryLatest(name) })));
  resolved
    .filter((x) => !x.version)
    .forEach((x) => out.push({ claim: `Dependency "${x.name}" is not published on the npm registry — verify it isn't a placeholder for a malicious tarball`, source: "npm registry", kind: "verified", severity: "medium", subject: x.name }));

  const queries = resolved.filter((x) => x.version).map((x) => ({ package: { ecosystem: "npm", name: x.name }, version: x.version! }));
  if (queries.length) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), OSV_TIMEOUT);
    try {
      const res = await fetch("https://api.osv.dev/v1/querybatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const data: any = await res.json();
        (data?.results ?? []).forEach((r: any, i: number) => {
          const mal = (r?.vulns ?? []).filter((v: any) => String(v.id).toUpperCase().startsWith("MAL"));
          if (mal.length) {
            out.push({ claim: `Dependency "${queries[i].package.name}@${queries[i].version}" is flagged MALICIOUS in the OSV database (${mal.slice(0, 3).map((v: any) => v.id).join(", ")})`, source: "OSV.dev", kind: "verified", severity: "high", subject: queries[i].package.name });
          }
        });
      }
    } catch {
      /* best-effort */
    } finally {
      clearTimeout(t);
    }
  }
  return out;
}

function metaSignals(meta: { createdAt?: string; stars?: number } | null): Evidence[] {
  if (!meta?.createdAt) return [];
  const ageDays = (Date.now() - new Date(meta.createdAt).getTime()) / 86_400_000;
  if (ageDays < 21) return [{ claim: `Repository was created only ${Math.max(0, Math.round(ageDays))} days ago${meta.stars != null ? ` and has ${meta.stars} stars` : ""} — throwaway repos are common in job-offer malware`, source: "GitHub", kind: "verified", severity: "low", subject: "repo age" }];
  return [];
}

function factsBlock(evidence: Evidence[]): string {
  if (!evidence.length) return "\n\nDeterministic checks found no install hooks, malicious dependencies, obfuscation, or typosquats.";
  const lines = evidence.map((e) => `- [${e.severity}] ${e.claim}`).join("\n");
  return `\n\nVERIFIED FACTS from deterministic checks + OSV.dev (authoritative — weigh heavily; a high-severity fact means SCAM):\n${lines}`;
}

export async function analyzeRepo(input: { repoUrl?: string; packageJson?: string }): Promise<ScamVerdict> {
  const { pkg, raw, source, meta } = await loadManifest(input);

  const osv = await osvSignals(pkg);
  const evidence: Evidence[] = [
    ...scriptSignals(pkg),
    ...depSourceSignals(pkg),
    ...typosquatSignals(pkg),
    ...osv,
    ...metaSignals(meta),
  ];

  const userText =
    `Assess this package/repository for supply-chain risk before a developer clones it and runs npm install.\n\n` +
    `Source: ${source}\n\npackage.json:\n"""\n${raw.slice(0, 8000)}\n"""` +
    factsBlock(evidence);

  const response = await getClient().messages.parse(
    {
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "disabled" },
      system: REPO_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(Verdict) },
    },
    { timeout: TIMEOUT_MS },
  );

  const verdict = response.parsed_output;
  if (!verdict) {
    throw new Error(response.stop_reason === "refusal" ? "Analysis was declined for safety reasons." : "Model did not return a parseable verdict.");
  }
  verdict.confidence = clamp(verdict.confidence);
  verdict.risk_score = clamp(verdict.risk_score);

  const high = evidence.some((e) => e.severity === "high");
  const med = evidence.some((e) => e.severity === "medium");
  if (high && verdict.verdict !== "scam") {
    verdict.verdict = "scam";
    verdict.risk_score = Math.max(verdict.risk_score, 85);
  } else if (med && verdict.verdict === "safe") {
    verdict.verdict = "caution";
    verdict.risk_score = Math.max(verdict.risk_score, 50);
  }

  return { ...verdict, evidence };
}
