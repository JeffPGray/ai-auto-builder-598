"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Site chat widget.
 *
 * Deliberately dependency-free and inline-styled. It ships on EVERY prospect site,
 * so it must not pull in an animation library, must not depend on any Tailwind
 * class existing in this particular build's palette, and must not break a static
 * export. Everything it needs is here.
 *
 * It talks to the SHARED chat service, not to a route on this site. These sites
 * are `output: 'export'` static; giving each one its own `/api/chat` would flip
 * every speculative build into a force-dynamic server app and put an Anthropic key
 * on every project. One service, N static sites.
 *
 * Colours come from CSS custom properties the build already sets, with hard
 * fallbacks so the widget is never invisible if a variable is missing.
 *
 * Two things it is now built around, both from defects found on a real iPhone:
 *
 * A. IT NEVER SITS ON TOP OF ANYTHING. The launcher is `position: fixed` in the
 *    bottom-right corner — the same corner a sticky mobile call bar lives in. It
 *    covered the "Call" button on two live sites. The launcher therefore lifts
 *    itself above any element marked `data-sticky-bottom` (measured, not guessed,
 *    so it tracks a bar that changes height) and always clears the iOS home
 *    indicator via `env(safe-area-inset-bottom)`.
 *
 * B. THE OPEN PANEL IS A BOUNDED FLOATING CARD ON A PHONE TOO, NOT A FULL-SCREEN
 *    TAKEOVER. An earlier version went full-screen (`inset:0`) below 640px because a
 *    fixed `height:32rem` card positioned from `bottom` measures against iOS
 *    Safari's LARGE (chrome-hidden) viewport at layout time, so once the chrome
 *    reappeared the card's top and its send button ended up behind it — a real
 *    defect, found on a real iPhone. But the full-screen sheet reads as a page
 *    navigation, not a chat bubble, and loses the "premium floating widget" feel a
 *    business owner expects (Jeff, 2026-08-18, comparing against the EuroLuxe
 *    Detailing site's chat framing, which stays a bounded card on mobile and looks
 *    right on a phone). The real fix for bug B was never "go full-screen" — it is
 *    "don't size the panel in a unit that gets the large-viewport measured against
 *    it": `100svh` (SMALL viewport height — the guaranteed-visible area with browser
 *    chrome fully SHOWN) caps the panel's height so it can never be taller than the
 *    worst-case visible area, regardless of which viewport state Safari measured it
 *    against. The panel stays anchored bottom-right with real margins, a border, a
 *    shadow and rounded corners — a floating card, exactly like desktop, just
 *    narrower and height-capped — and the launcher hides while it's open so nothing
 *    overlaps. The input is 16px for a different iOS reason: it auto-zooms any
 *    focused input under 16px, and that zoom is what a visitor experiences as "I had
 *    to zoom to see the box".
 *
 * The mobile rules need media queries and `env()`, which inline styles cannot
 * express, so the widget carries its own scoped stylesheet. It is static,
 * author-written text with no interpolation — same reasoning as Motion.tsx.
 */

const CHAT_CSS = `
.kchat-launcher{position:fixed;right:1.25rem;z-index:1000;width:3.5rem;height:3.5rem;
border-radius:9999px;border:none;cursor:pointer;display:flex;align-items:center;
justify-content:center;box-shadow:0 8px 30px rgba(0,0,0,0.28);
bottom:calc(1.25rem + env(safe-area-inset-bottom, 0px) + var(--kchat-lift, 0px))}
.kchat-panel{position:fixed;right:1.25rem;z-index:1001;display:flex;flex-direction:column;
width:22rem;max-width:calc(100vw - 2.5rem);height:32rem;overflow:hidden;
border-radius:1rem;background:#ffffff;color:#111827;border:1px solid rgba(0,0,0,0.10);
box-shadow:0 24px 60px rgba(0,0,0,0.24);
bottom:calc(5.5rem + env(safe-area-inset-bottom, 0px) + var(--kchat-lift, 0px));
max-height:calc(100dvh - 8rem)}
.kchat-input{flex:1;min-width:0;padding:0.6rem 0.9rem;border-radius:9999px;
border:1px solid rgba(0,0,0,0.18);font-size:16px;line-height:1.25;outline:none;
background:#ffffff;color:#111827}
.kchat-close{display:none;background:none;border:none;padding:0.25rem;cursor:pointer;
color:inherit;line-height:0}
/* The launcher is fixed in the bottom-right corner, so whatever the page puts
   there is under it. Mark that element (in practice the footer's last row) with
   data-chat-gutter and its content is inset clear of the bubble. */
[data-chat-gutter]{padding-right:5rem}
@media (max-width: 640px){
  /* Bounded floating card, not a full-screen takeover (2026-08-18 — matches the
   framing EuroLuxe Detailing's chat widget uses on mobile, at Jeff's direction).
   Only width/height/position change here; border, radius, background and shadow
   are inherited from the base .kchat-panel rule above, so it keeps looking like a
   card floating over the page instead of a separate screen.

   height/max-height use 100svh (SMALL viewport height — the guaranteed-visible
   area with iOS Safari's browser chrome fully SHOWN), never 100dvh or a bare rem
   value. That is what actually fixes the real-iPhone bug the old inset:0 sheet was
   worked around instead of fixed: a card sized against the LARGE (chrome-hidden)
   viewport can end up taller than what's visible once the chrome reappears, and a
   bottom-anchored fixed element does not reflow to compensate. Capping height at
   the SMALL viewport means the card can never exceed the worst-case visible area,
   regardless of which viewport state Safari measured it against. */
  .kchat-panel{
    right:0.75rem;
    left:0.75rem;
    width:auto;
    max-width:none;
    height:min(32rem, calc(100svh - 7.5rem));
    max-height:calc(100svh - 7.5rem)}
  .kchat-close{display:inline-flex}
  .kchat-launcher[data-open="true"]{display:none}
}`;

type Msg = { role: "user" | "assistant"; content: string };

export type SiteChatProps = {
  /** Business name, shown in the header and used in the fallback line. */
  businessName: string;
  /** Formatted phone number, e.g. "(972) 849-6443". Omit if the business has none. */
  phoneDisplay?: string;
  /** First line the visitor sees. Write it in the site's language and voice. */
  greeting?: string;
  /** One short line under the business name, e.g. "Ask us anything about your yard". */
  subtitle?: string;
  /** Overrides the shared service URL. Normally leave unset. */
  serviceUrl?: string;
};

/**
 * The one shared service, LIVE and verified. `GET /api/health` returns 200 and
 * reports `keyConfigured`, `allowedHostSuffixes` and the caps actually in force.
 *
 * ⚠️ THIS HOSTNAME SHIPS TO EVERY PROSPECT. It is inlined into the client bundle,
 * so whatever is written here is readable by anyone who views source on a site we
 * sent to a business owner. It therefore MUST be a neutral Gray Reserve hostname
 * and must never name the build tooling.
 *
 * That is not hypothetical. Until 2026-08-16 this constant read
 * `<tool-name>-site-chat.vercel.app`, and the pre-deploy ship scan caught it in the
 * shipped JS of the first build it was ever pointed at — a real prospect site
 * disclosing both the vendor behind the build and the shared endpoint's address.
 * `chat.grayreserve.agency` was aliased onto the same deployment and verified
 * (`/api/health` 200) so the neutral name is the one that travels.
 *
 * This constant is the ONLY place the endpoint is written down, so a move is a
 * one-line change here. `NEXT_PUBLIC_CHAT_SERVICE_URL` overrides it, but note it is
 * inlined at the CLIENT SITE's build time, so it only takes effect if it is exported
 * into the environment running `next build` for that site.
 */
const DEFAULT_SERVICE =
  process.env.NEXT_PUBLIC_CHAT_SERVICE_URL || "https://chat.grayreserve.agency";

export default function SiteChat({
  businessName,
  phoneDisplay,
  greeting,
  subtitle,
  serviceUrl,
}: SiteChatProps) {
  const hello = greeting || `Hi. Ask me anything about ${businessName} and I'll help if I can.`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: hello }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Lift the launcher above a site-wide sticky bottom bar.
   *
   * Any element the build pins to the bottom of the viewport on mobile — a call
   * bar, a booking bar, a cookie strip — carries `data-sticky-bottom`. Its height
   * is measured rather than assumed, because that bar's height changes with the
   * palette's type scale and with the safe-area inset. `--kchat-lift` is read by
   * both the launcher and the floating desktop panel. No bar, no lift.
   */
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-sticky-bottom]");
    const root = document.documentElement;
    if (!bar) {
      root.style.setProperty("--kchat-lift", "0px");
      return;
    }
    const apply = () => {
      root.style.setProperty("--kchat-lift", `${Math.round(bar.getBoundingClientRect().height)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--kchat-lift");
    };
  }, []);

  // A full-screen sheet behind a scrolling page is a scroll-chaining trap on iOS.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch(`${serviceUrl || DEFAULT_SERVICE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site: window.location.origin,
          // The greeting is ours, not the model's — don't replay it as history.
          messages: next.slice(1),
        }),
      });
      const data = (await r.json()) as { reply?: string };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply || "Tell me a bit more about what you need.",
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: phoneDisplay
            ? `Sorry, I had trouble there. Give us a ring on ${phoneDisplay} and we'll help you out.`
            : "Sorry, I had trouble there. Please use the contact form and we'll get back to you.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // Fallback chain prefers the DERIVED fill pair (scripts/derive-palette.mjs):
  // a raw brand accent under white text is the measured 2.5-2.9:1 WCAG failure,
  // so --accent is only ever the last resort before neutral ink, never the
  // preferred target. Builds set --chat-accent: var(--accent-fill) explicitly;
  // this chain keeps the widget compliant even when a build forgets to.
  const accent = "var(--chat-accent, var(--accent-fill, #1f2937))";
  const onAccent = "var(--chat-on-accent, var(--on-accent-fill, #ffffff))";

  return (
    <>
      <style>{CHAT_CSS}</style>

      <button
        type="button"
        className="kchat-launcher"
        data-open={open ? "true" : "false"}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : `Chat with ${businessName}`}
        aria-expanded={open}
        style={{ background: accent, color: onAccent }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Chat with ${businessName}`}
          className="kchat-panel"
        >
          <div
            style={{
              background: accent,
              color: onAccent,
              padding: "0.85rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.2 }}>{businessName}</p>
              <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.9 }}>
                {subtitle || "Ask us anything"}
              </p>
            </div>
            <button
              type="button"
              className="kchat-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div
            ref={scrollRef}
            data-lenis-prevent
            style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f8f8f7" }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  marginBottom: "0.75rem",
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    maxWidth: "85%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "1rem",
                    fontSize: "0.95rem",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    background: m.role === "user" ? accent : "#ffffff",
                    color: m.role === "user" ? onAccent : "#111827",
                    border: m.role === "user" ? "none" : "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  {m.content}
                </p>
              </div>
            ))}
            {busy && (
              <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }} aria-live="polite">
                Typing...
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            style={{
              display: "flex",
              gap: "0.5rem",
              padding: "0.75rem",
              borderTop: "1px solid rgba(0,0,0,0.08)",
              background: "#ffffff",
              flexShrink: 0,
            }}
          >
            <label htmlFor="site-chat-input" style={{ position: "absolute", left: "-9999px" }}>
              Your message
            </label>
            <input
              id="site-chat-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message"
              autoComplete="off"
              className="kchat-input"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send message"
              style={{
                width: "2.5rem",
                height: "2.5rem",
                flexShrink: 0,
                borderRadius: "9999px",
                border: "none",
                cursor: busy || !input.trim() ? "default" : "pointer",
                opacity: busy || !input.trim() ? 0.4 : 1,
                background: accent,
                color: onAccent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
