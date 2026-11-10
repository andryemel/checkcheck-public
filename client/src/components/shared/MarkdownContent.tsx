import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { ACTIVITY_ENTITY_LINK_CLASS } from "@/components/activity/activityLinkStyles";

/** The address from a mailto: link ("mailto:bob@x.com?subject=…" → "bob@x.com"). Pure. */
export function emailFromMailto(href: string): string {
  const raw = href.slice("mailto:".length).split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function EmailWithCopy({ href, children }: { href: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  // On a touch screen there is no hover: a tap on the address reveals the button (founder 2026-10-01).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setRevealed(false), 4000);
    return () => window.clearTimeout(t);
  }, [revealed]);
  const email = emailFromMailto(href);
  return (
    // The button is ABSOLUTE, so the sentence keeps its own spacing (the full stop follows the address),
    // and hidden until the address is hovered or tapped; it is round, and white so it covers the character
    // it floats over while shown.
    <span className="group/email relative inline-block whitespace-nowrap" data-testid="email-with-copy">
      <span
        onClick={(e) => {
          if (window.matchMedia?.("(hover: none)").matches) {
            e.stopPropagation();
            setRevealed((v) => !v);
          }
        }}
      >
        {children}
      </span>
      <button
        type="button"
        aria-label={copied ? "Copied" : `Copy ${email}`}
        title={copied ? "Copied" : "Copy email address"}
        onClick={(e) => {
          // The message itself toggles its actions on a tap: this tap is only the copy.
          e.stopPropagation();
          void navigator.clipboard?.writeText(email).catch(() => {});
          setCopied(true);
        }}
        className={cn(
          "absolute left-full top-1/2 z-10 ml-1 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[#F0F0F0] bg-white text-muted-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-opacity hover:text-foreground focus-visible:opacity-100",
          revealed || copied ? "opacity-100" : "opacity-0 group-hover/email:opacity-100 [@media(hover:none)]:pointer-events-none [@media(hover:none)]:group-hover/email:opacity-0",
          revealed && "[@media(hover:none)]:pointer-events-auto",
        )}
      >
        {copied ? <Check className="!h-3.5 !w-3.5" /> : <Copy className="!h-3.5 !w-3.5" />}
      </button>
    </span>
  );
}

const markdownComponents: Components = {
  // An in-app path ("/contacts/<id>") is a router link in the house entity-link
  // style (semibold, dotted underline on hover — the To Do cards and the feed);
  // `no-underline` beats prose's default underline. Anything else opens in a new tab.
  a({ href, children, title }) {
    // A citation chip (CheckCheck, founder 2026-09-30): `[Bloomberg](url "source")` — a rounded favicon and
    // the source's short name, inline beside the sentence it supports; the text keeps its entity links.
    if (title === "source" && href) {
      let host = "";
      try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { host = ""; }
      return (
        <a href={href} target="_blank" rel="noreferrer" title={href} data-source-chip className="relative -top-px mx-0.5 inline-flex h-[20px] max-w-[220px] items-center gap-1 rounded-full border border-[#F0F0F0] bg-white px-1.5 align-middle !text-[11px] !font-medium !leading-none !no-underline text-black transition-colors hover:bg-[#FAFAFA]">
          {host && <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-3 w-3 flex-shrink-0 rounded-full object-cover" />}
          <span className="truncate">{children}</span>
        </a>
      );
    }
    if (href && href.startsWith("/") && !href.startsWith("//")) {
      return <Link to={href} className={cn("no-underline", ACTIVITY_ENTITY_LINK_CLASS)}>{children}</Link>;
    }
    // An email address is shown as plain text, never an underlined mail link (founder 2026-09-25).
    // One tap copies it (founder 2026-09-28: selecting an address on a phone was a fight).
    if (href?.startsWith("mailto:")) return <EmailWithCopy href={href}>{children}</EmailWithCopy>;
    return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>;
  },
  code({ className, children, ...props }) {
    const isBlock = className?.includes("language-") || className?.includes("hljs");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    // Inline code is drawn as ORDINARY text (founder 2026-10-01): the model wraps an email address, a
    // reference or a name in backticks now and then, and a grey monospace box in the middle of a
    // sentence reads as machinery. Fenced blocks (real code, with a language) keep their look.
    return <span {...props}>{children}</span>;
  },
  pre({ children }) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg bg-muted/60 p-4 text-[13px]">
        {children}
      </pre>
    );
  },
};

const proseClasses = cn(
  "prose prose-sm max-w-none break-words leading-relaxed text-foreground",
  "[&_*]:text-[15px] [&_*]:leading-7",
  "[&_p]:my-2.5 [&_ul]:my-2.5 [&_ol]:my-2.5",
  "[&_li]:my-1 [&_li]:marker:text-muted-foreground",
  "[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:bg-muted/60 [&_pre]:p-4 [&_pre]:overflow-x-auto",
  "[&_pre_code]:text-[13px] [&_pre_code]:font-mono",
  "[&_table]:text-sm [&_th]:font-semibold"
);

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn(proseClasses, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
