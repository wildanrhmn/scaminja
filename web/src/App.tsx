import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Background from "./components/Background";
import TryConsole from "./components/TryConsole";

const CURL = `curl -X POST https://scaminja.app/x402/analyze \\
  -H "content-type: application/json" \\
  -d '{"text":"is this a scam? …"}'

# → HTTP 402: pay 0.02 USDT on X Layer (x402), then
#   receive the verdict + evidence JSON. Same endpoint
#   also scans a repo: {"repoUrl":"https://github.com/o/r"}`;

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState(false);

  useGSAP(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // sticky nav background on scroll
    const onScroll = () => setScrolled(scrollY > 12);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });

    if (!reduce) {
      gsap.registerPlugin(ScrollTrigger);

      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(".hero-inner .motion", { y: 30, opacity: 0, duration: 0.75, stagger: 0.1 })
        .from(".hero-bottom .metric", { y: 18, opacity: 0, duration: 0.5, stagger: 0.07 }, "-=0.35");

      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) =>
        gsap.to(el, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 86%" } }),
      );

      gsap.from(".pcard", { y: 44, opacity: 0, duration: 0.7, stagger: 0.1, ease: "power3.out", scrollTrigger: { trigger: ".process", start: "top 82%" } });

      gsap.utils.toArray<HTMLElement>("[data-count],[data-text]").forEach((el) => {
        const txt = el.dataset.text, suf = el.dataset.suffix || "", end = parseFloat(el.dataset.count || "0"), obj = { v: 0 };
        ScrollTrigger.create({
          trigger: el, start: "top 92%", once: true,
          onEnter: () => {
            if (txt) gsap.fromTo(obj, { v: 0 }, { v: parseFloat(txt), duration: 1.1, ease: "power2.out", onUpdate: () => (el.textContent = obj.v.toFixed(2)) });
            else gsap.fromTo(obj, { v: 0 }, { v: end, duration: 1.1, ease: "power2.out", onUpdate: () => (el.innerHTML = Math.round(obj.v) + (suf ? `<span class="u">${suf}</span>` : "")) });
          },
        });
      });
    }

    return () => removeEventListener("scroll", onScroll);
  }, { scope: root });

  function copy() {
    navigator.clipboard?.writeText(CURL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  }

  return (
    <div ref={root}>
      <Background />

      <header className={"nav-shell" + (scrolled ? " scrolled" : "")}>
        <nav className="inner">
          <div className="brand">
            <img className="logo" src="/scaminja.png" alt="Scaminja" width={32} height={32} />
            <span className="brand-name">Scaminja</span>
          </div>
          <div className="nav-right">
            <a className="nav-link hide-sm" href="#how">How it works</a>
            <a className="nav-link hide-sm" href="#check">Try it</a>
            <a className="nav-link hide-sm" href="#agents">API</a>
            <a className="okx" href="https://www.okx.ai" target="_blank" rel="noopener">ASP on <b>OKX.AI</b></a>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="inner hero-inner">
            <span className="eyebrow motion"><span className="di">◆</span> AI scam, phishing &amp; malware detection</span>
            <h1 className="motion">Is it legit?<br /><span className="grad">Know in seconds.</span></h1>
            <p className="sub motion">Throw it anything — a message, link, email, wallet address, screenshot, PDF, or a whole GitHub repo — and get an instant <b>Safe · Caution · Scam</b> verdict, backed by evidence from real security databases.</p>
            <div className="hero-actions motion">
              <a className="btn btn-primary" href="#check">Check a message <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg></a>
              <a className="btn" href="#how">How it works</a>
            </div>
          </div>
          <div className="inner hero-bottom">
            <div className="proof">
              <div className="metric"><span className="mv" data-count="6">6</span><span className="ml">live threat databases</span></div>
              <div className="metric"><span className="mv" data-count="70" data-suffix="+">70+</span><span className="ml">AV vendors · VirusTotal</span></div>
              <div className="metric"><span className="mv" data-count="3">3</span><span className="ml">clear verdict levels</span></div>
              <div className="metric"><span className="mv" data-text="0.02">0.02</span><span className="ml">USDT per agent call</span></div>
            </div>
          </div>
        </section>

        <section className="how light" id="how">
          <div className="inner">
            <div className="kicker reveal"><span className="eyebrow"><span className="di">◆</span> How it works</span></div>
            <div className="split-intro">
              <h2 className="reveal">Evidence,<br /><span className="grad">not opinion.</span></h2>
              <p className="reveal">Most "is this a scam?" tools just guess. Scaminja pulls every link, address, email, and dependency out of whatever you give it, verifies each against authoritative databases, then shows you the proof — tagged verified fact vs assessment.</p>
            </div>
            <div className="process">
              <article className="pcard"><span className="pn">Step 01</span><h3>Extract</h3><p>From a message, screenshot, PDF, or GitHub repo, it pulls out every URL, wallet address, token, email sender, and code dependency.</p></article>
              <article className="pcard"><span className="pn">Step 02</span><h3>Verify</h3><p>Each one is checked in parallel — Safe Browsing, VirusTotal, GoPlus, OFAC, domain records, brand look-alikes, and the OSV malware database — live.</p></article>
              <article className="pcard"><span className="pn">Step 03</span><h3>Verdict</h3><p>A clear Safe / Caution / Scam call with the red flags, the cited evidence, and exactly what to do next — in seconds.</p></article>
              <article className="pcard end"><span className="pn">Ready</span><h3>Try it yourself</h3><p>Paste anything into the checker below — free, no account, and nothing you submit is stored.</p></article>
            </div>
          </div>
        </section>

        <section className="try" id="check">
          <div className="inner">
            <div className="try-head">
              <div className="kicker reveal"><span className="eyebrow"><span className="di">◆</span> Try it free</span></div>
              <h2 className="reveal">Paste it.<br /><span className="grad">Know instantly.</span></h2>
              <p className="sub reveal">Drop in a suspicious message, link, email, or wallet — a screenshot or PDF — or a <b>GitHub repo URL / package.json</b>. Scaminja auto-detects it and returns an evidence-backed verdict in seconds. Free, no account, nothing stored.</p>
            </div>
            <TryConsole />
          </div>
        </section>

        <section className="agents" id="agents">
          <div className="inner">
            <div className="kicker reveal"><span className="eyebrow"><span className="di">◆</span> For the agent economy</span></div>
            <div className="split-intro">
              <h2 className="reveal">Built for<br /><span className="grad">agents, too.</span></h2>
              <p className="reveal">Scaminja is <b>one</b> paid, callable endpoint any AI agent can rent on demand — send it a message, wallet, screenshot, PDF, or a GitHub repo, and get a structured verdict + evidence back. Pay per call, settled on-chain via the x402 standard.</p>
            </div>
            <div className="agents-split">
              <div className="reveal">
                <ul className="spec">
                  <li><span>Protocol</span><b>x402 · A2MCP</b></li>
                  <li><span>Price</span><b>0.02 USDT / call</b></li>
                  <li><span>Network</span><b>X Layer</b></li>
                  <li><span>Output</span><b>JSON verdict + evidence</b></li>
                </ul>
              </div>
              <div className="terminal reveal">
                <div className="term-bar">
                  <span className="cdot scam" /><span className="cdot caution" /><span className="cdot safe" />
                  <span className="term-title">POST /x402/analyze</span>
                  <button className="copy" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
                </div>
                <pre><code>
                  <span className="tok-c">curl</span> -X POST <span className="tok-s">https://scaminja.app/x402/analyze</span> {"\\"}{"\n"}
                  {"  "}-H <span className="tok-s">"content-type: application/json"</span> {"\\"}{"\n"}
                  {"  "}-d <span className="tok-s">{"'{\"text\":\"is this a scam? …\"}'"}</span>{"\n\n"}
                  <span className="tok-m"># → HTTP 402: pay 0.02 USDT on X Layer (x402), then</span>{"\n"}
                  <span className="tok-m">#   receive the verdict + evidence JSON. Same endpoint</span>{"\n"}
                  <span className="tok-m">{"#   also scans a repo: {\"repoUrl\":\"https://github.com/o/r\"}"}</span>
                </code></pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="inner">
          <div className="foot-mark">SCAMINJA</div>
          <div className="foot-meta">
            Risk guidance, not a guarantee — always verify independently. Scaminja does not store the content you submit.<br />
            An Agentic Service Provider on <a href="https://www.okx.ai" target="_blank" rel="noopener">OKX.AI</a>.
          </div>
        </div>
      </footer>
    </div>
  );
}
