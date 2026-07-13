import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Verdict } from "./schema.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { enrich } from "../enrich/index.js";
import type { Evidence } from "../enrich/types.js";
import type { AnalyzeInput } from "../types.js";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";
const OCR_MODEL = process.env.OCR_MODEL ?? "claude-haiku-4-5";
const TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS ?? 45_000);

// Pull the visible text + any URLs/addresses/emails out of a screenshot so the
// same live-source validators that run on pasted text can run on images too.
async function transcribeImage(imageBase64: string, mediaType: string): Promise<string> {
  try {
    const r = await getClient().messages.create(
      {
        model: OCR_MODEL,
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType as any, data: imageBase64 } },
              {
                type: "text",
                text: "Transcribe ALL text visible in this image verbatim, and separately list every URL, domain, email address, crypto wallet/token address, and phone number shown. Output only the raw extracted text — no commentary.",
              },
            ],
          },
        ],
      },
      { timeout: 20_000 },
    );
    return r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("\n").trim();
  } catch {
    return "";
  }
}

export interface ScamVerdict extends Verdict {
  evidence: Evidence[];
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function factsBlock(evidence: Evidence[]): string {
  if (evidence.length === 0) return "";
  const lines = evidence.map((e) => `- [${e.severity}] ${e.claim} (source: ${e.source})`).join("\n");
  return (
    `\n\nVERIFIED FACTS from authoritative sources (checked live against real databases — treat as authoritative and weigh heavily). ` +
    `A high-severity verified fact (Safe Browsing hit, OFAC sanction, known drainer) must drive the verdict to SCAM. Cite them:\n${lines}`
  );
}

export async function analyze(input: AnalyzeInput): Promise<ScamVerdict> {
  const hasText = !!input.text?.trim();
  const hasImage = !!input.imageBase64;
  if (!hasText && !hasImage) throw new Error("Provide `text` and/or `imageBase64` to analyze.");

  // Enrich runs on text; for screenshots we first transcribe the image so the
  // URLs/addresses inside it get validated against live sources too.
  let enrichSource = input.text?.trim() ?? "";
  if (hasImage) {
    const transcript = await transcribeImage(input.imageBase64!, input.imageMediaType ?? "image/png");
    if (transcript) enrichSource = enrichSource ? `${enrichSource}\n${transcript}` : transcript;
  }
  const evidence: Evidence[] = enrichSource ? (await enrich(enrichSource)).evidence : [];

  const content: Anthropic.ContentBlockParam[] = [];
  if (hasImage) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: input.imageMediaType ?? "image/png", data: input.imageBase64! },
    });
  }

  const hint = input.typeHint ? `\n\n(Caller hint about the content type: ${input.typeHint})` : "";
  content.push({
    type: "text",
    text:
      (hasText
        ? `Assess whether the following is a scam. Return your verdict.\n\n"""\n${input.text!.trim()}\n"""${hint}`
        : `Assess whether the attached screenshot shows a scam. Return your verdict.${hint}`) + factsBlock(evidence),
  });

  const response = await getClient().messages.parse(
    {
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(Verdict) },
    },
    { timeout: TIMEOUT_MS },
  );

  const verdict = response.parsed_output;
  if (!verdict) {
    throw new Error(
      response.stop_reason === "refusal"
        ? "Analysis was declined for safety reasons."
        : "Model did not return a parseable verdict.",
    );
  }

  verdict.confidence = clamp(verdict.confidence);
  verdict.risk_score = clamp(verdict.risk_score);

  // Verified facts are authoritative — never report "safe" when one is flagged.
  const highVerified = evidence.some((e) => e.kind === "verified" && e.severity === "high");
  const medVerified = evidence.some((e) => e.kind === "verified" && e.severity === "medium");
  if (highVerified && verdict.verdict !== "scam") {
    verdict.verdict = "scam";
    verdict.risk_score = Math.max(verdict.risk_score, 85);
  } else if (medVerified && verdict.verdict === "safe") {
    verdict.verdict = "caution";
    verdict.risk_score = Math.max(verdict.risk_score, 50);
  }

  return { ...verdict, evidence };
}
