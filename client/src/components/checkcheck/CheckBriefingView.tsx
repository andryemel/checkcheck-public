import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, MapPin, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { saveCheckContact, saveCheckEdits, type CheckRun, type OwnerEdits, type OwnerEditsPatch } from "@/services/checkCheckService";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { extractProfileHeading, splitBriefingSections } from "./briefingSections";
import { reflowParagraphs } from "./paragraphs";
import { buildCheckLinkPills, companyTokens, hostBelongsTo, type CheckLinkPill } from "./checkLinks";
import { CheckLinkPills } from "./CheckLinkPills";
import { LINKS_SECTION_TITLE, buildCompanyLinkIndex, buildEntityLinks, linkifyEntities, linkifyRoleCompanies, roleCompanies, stripLinksLines, tidyProfileBody } from "./profileLinks";
import { boldNumbers } from "./numbers";
import { KNOWN_NAMES, brandToken, chipifySourceLinks, hostOf, namesInText, outletLinks, parseSourcePages } from "./sourcePages";
import { extractSourceChips } from "./sourceChips";
import { SourceChipRow } from "./SourceChipRow";
import { applyEditsToSections, sectionKey } from "./ownerEdits";
import { EditPencil, joinProseAndChips, splitProseAndChips } from "./SectionEditor";
import { ComposerChip } from "@/components/shared/ComposerChip";
import jinnaSphere from "@/assets/jinna-sphere.png";
import { SETTINGS_SECTION_CLASS, SETTINGS_SECTION_SUBTITLE_CLASS, SETTINGS_SECTION_TITLE_CLASS } from "@/components/company/settingsSection";
import { TODO_CARD_SURFACE_CLASS } from "@/components/todo/todoCardSurface";
import { cn } from "@/lib/utils";

/**
 * ONE renderer for a finished briefing (docs/CHECKCHECK_PLAN.md §12 step 1): the chat card
 * and the contact page draw the same report, with the owner's edits applied, the same pills
 * and source rows, and — when `editable` — a pencil on every section, pill and profile line.
 * Styled like a Skills settings page: one grey surface, the profile block and In brief
 * straight on it, the other sections titled on white cards.
 */
export const SECTION_CLASS = cn(SETTINGS_SECTION_CLASS, "space-y-4");
export const INNER_CARD_CLASS = cn(TODO_CARD_SURFACE_CLASS, "min-w-0 px-5 py-4 sm:px-[30px] sm:py-6");
// Inline links read like the To Do card's entity links (activityLinkStyles): semibold, dotted underline on hover.
export const BRIEFING_PROSE_CLASS = "text-gray-800 [&_*]:!text-sm [&_*]:!leading-6 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul:first-child]:mt-0 [&_ul:last-child]:mb-0 [&_a]:font-semibold [&_a]:!no-underline [&_a:hover]:!underline [&_a]:decoration-dotted [&_a]:decoration-gray-300 [&_a]:underline-offset-2";
const PILL_BUTTON_CLASS = "rounded-full h-9 px-4 bg-white border border-[#F0F0F0] font-inter font-medium text-black text-[13px] transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100";
const SKIP_PILL_CLASS = "rounded-full h-9 px-4 bg-transparent font-inter font-medium text-muted-foreground text-[13px] transition-colors hover:text-foreground disabled:opacity-50";

/** The app's own "Sources checked on …" list stays on the row for audit; the card does not render it (founder 2026-09-30). */
const isSourcesSection = (title: string | null) => !!title && /^Sources checked/i.test(title);
const isProfileSection = (title: string | null) => !!title && /^Profile$/i.test(title);
/** "Your connection" is Jinna's own reading of the overlap, so its card ends with a pill saying so (founder 2026-09-30). */
const isConnectionSection = (title: string | null) => !!title && /^Your connection$/i.test(title);
/** "In brief" follows the profile lines on the grey surface with no title of its own (founder 2026-09-30). */
const isInBriefSection = (title: string | null) => !!title && /^In brief$/i.test(title);

/**
 * Prose, block by block: each paragraph or list renders clean, and its citation chips (the
 * server's placement at the paragraph's end plus the model's inline citations) render as a
 * row under it — never inside the text (founder 2026-09-30).
 */
export function BriefingProse({ markdown, trailer, onSaveText, modifiedOn }: { markdown: string; trailer?: ReactNode; onSaveText?: (text: string) => Promise<boolean>; modifiedOn?: string | null }) {
  const blocks = markdown.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  // ONE Sources row per section (founder 2026-09-30, final): every paragraph's chips gather at the bottom of the card.
  const texts: string[] = [];
  const chips: ReturnType<typeof extractSourceChips>["chips"] = [];
  for (const block of blocks) {
    const out = extractSourceChips(block.replace(/^Also read:\s*/i, ""));
    if (out.text) texts.push(out.text);
    for (const c of out.chips) if (!chips.some((p) => p.url === c.url)) chips.push(c);
  }
  // Two pencils (founder 2026-10-01): one at the end of the text, one on the group of sources; each shows on its own hover.
  // The text is edited in place (EditableProse), the sources in their own editor.
  return (
    <div className="space-y-4">
      {onSaveText ? (
        <EditableProse paragraphs={texts} className={cn("group/edit space-y-4", BRIEFING_PROSE_CLASS)} onSave={onSaveText} pencilLabel="Edit this text" testId="check-section-prose" />
      ) : (
        <div className="space-y-4" data-testid="check-section-prose">
          {texts.map((text, i) => <MarkdownContent key={i} content={text} className={BRIEFING_PROSE_CLASS} />)}
        </div>
      )}
      {trailer || chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="check-section-sources">
          {trailer}
          <SourceChipRow chips={chips} modifiedOn={modifiedOn} />
        </div>
      ) : null}
    </div>
  );
}

const PROFILE_FRAME_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*(?:Name|Location|Links?|Direct identity links?|Identity links?|Profile links?)\s*:?\s*(?:\*\*)?\s*:?/i;

/** The edited role lines placed back between the Profile's Name / Location lines and its Links line. Pure. */
export function withProfileFrame(originalBody: string, editedRoleLines: string): string {
  const lines = originalBody.split("\n");
  const head = lines.filter((l) => /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*(?:Name|Location)\s*:?/i.test(l));
  const links = lines.filter((l) => PROFILE_FRAME_LINE.test(l) && !/^\s*(?:[-*+]\s+)?(?:\*\*)?\s*(?:Name|Location)\s*:?/i.test(l));
  return [...head, editedRoleLines.trim(), ...links].filter(Boolean).join("\n");
}

/** What the owner typed, read back from the edited DOM: one paragraph per block or line break; presentation markup (bold, links) falls away. */
export function readProse(el: HTMLElement): string {
  const withText = el as HTMLElement & { innerText?: string };
  const raw = typeof withText.innerText === "string" && withText.innerText
    ? withText.innerText
    : el.children.length > 0
      ? Array.from(el.children).map((c) => (c.textContent ?? "").trim()).filter(Boolean).join("\n\n")
      : el.textContent ?? "";
  return raw.split(/\n+/).map((p) => p.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n\n");
}

/**
 * The text edited IN PLACE (founder 2026-10-01: "keep paragraph spaces and semibold text"): the rendered
 * paragraphs are contentEditable, so the caret lands where the owner clicks, the layout never changes and the
 * semibold names stay while typing. Leaving the block saves when the words changed; Escape puts the original
 * back. Links inside still open (new tab). The saved text is plain paragraphs; names and numbers are
 * re-styled on render as always.
 */
/** The last block that holds text — the final <p>, or the final <li> (its <p> when it has one) — so the pencil can sit after the last word. */
function lastTextBlock(root: HTMLElement): HTMLElement {
  let node: HTMLElement = root;
  for (;;) {
    const blocks = Array.from(node.children).filter((c): c is HTMLElement => c instanceof HTMLElement && /^(DIV|P|UL|OL|LI|BLOCKQUOTE)$/.test(c.tagName) && !c.hasAttribute("data-pencil"));
    const last = blocks[blocks.length - 1];
    if (!last) return node;
    if (last.tagName === "P") return last;
    node = last;
  }
}

/** One line under the element whose save failed; it goes on the next edit or the next successful save. */
const SAVE_ERROR_CLASS = "text-xs text-destructive";
const SAVE_FAILED_TEXT = "Couldn't save. Your change was not kept.";
const LINK_SAVE_FAILED_TEXT = "Couldn't save this link. Check the address and try again.";

/** A save resolves true when the server kept the change. */
type SaveResult = Promise<boolean>;

function EditableProse({ paragraphs, className, onSave, pencilLabel, testId }: { paragraphs: string[]; className?: string; onSave: (text: string) => SaveResult; pencilLabel: string; testId?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const original = useRef<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pencilAt, setPencilAt] = useState<{ left: number; top: number } | null>(null);
  // React never owns a node inside the editable root: select-all + typing replaces every node there, and React
  // removing a node it no longer finds threw NotFoundError and took the card down (dev 2026-10-02). The markdown
  // renders into a detached box (a portal keeps the router context) and its markup is copied into the root.
  const [source] = useState(() => document.createElement("div"));
  const content = paragraphs.join("\n\n");
  // The pencil is a sibling of the editable root, laid over a blank slot glued to the last word with a no-break
  // space, so it still follows the last word on its line and a full last line wraps word and pencil together
  // (founder 2026-10-01). Nothing React renders sits inside the root.
  const placePencil = useCallback(() => {
    const wrap = wrapRef.current;
    const slot = ref.current?.querySelector("[data-pencil-slot]");
    if (!wrap || !slot) { setPencilAt(null); return; }
    const a = slot.getBoundingClientRect();
    const b = wrap.getBoundingClientRect();
    setPencilAt((prev) => (prev && prev.left === a.left - b.left && prev.top === a.top - b.top ? prev : { left: a.left - b.left, top: a.top - b.top }));
  }, []);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || original.current !== null) return; // mid-edit: the owner's words stay; blur puts the stored text back
    root.innerHTML = source.innerHTML;
    const spacer = document.createElement("span");
    spacer.className = "select-none whitespace-nowrap";
    spacer.contentEditable = "false";
    spacer.setAttribute("data-pencil", "");
    spacer.textContent = "\u00A0";
    const slot = document.createElement("span");
    slot.className = "inline-block h-6 w-6 align-middle";
    slot.setAttribute("data-pencil-slot", "");
    spacer.appendChild(slot);
    lastTextBlock(root).appendChild(spacer);
    // Put back while focused (Escape, a failed save): this IS the text the next blur compares against.
    if (document.activeElement === root) original.current = readProse(root);
    placePencil();
  }, [epoch, content, source, placePencil]);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => placePencil());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [placePencil]);
  const snapshot = () => { if (ref.current && original.current === null) original.current = readProse(ref.current); };
  const restore = () => { original.current = null; setEpoch((n) => n + 1); };
  return (
    <div ref={wrapRef} className="group/edit relative">
      {createPortal(paragraphs.map((text, i) => <MarkdownContent key={i} content={text} />), source)}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className={cn(className, "cursor-text outline-none [&_a]:cursor-pointer")}
        data-testid={testId}
        onFocus={snapshot}
        onMouseDown={snapshot}
        onInput={() => { setFailed(false); placePencil(); }}
        // Links stay clickable inside the editable text (founder 2026-10-01): a click on a link opens it in a new
        // tab instead of placing the caret; click beside the word to edit it. An edited word loses its link on
        // save (links are presentation, re-applied on render where the name still matches); the section's
        // sources are kept regardless (joinProseAndChips).
        onClick={(e) => {
          const anchor = (e.target as HTMLElement | null)?.closest?.("a");
          if (!anchor) return;
          e.preventDefault();
          const href = anchor.getAttribute("href");
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); restore(); }
        }}
        onBlur={() => {
          if (!ref.current) return;
          const next = readProse(ref.current);
          const before = original.current;
          original.current = null;
          if (before === null || next === before) { setEpoch((n) => n + 1); return; } // untouched: put the rendered markup back exactly
          setFailed(false);
          // A refused or failed save must not look saved (dev 2026-10-02): the stored text comes back and one line says so.
          void onSave(next).then((ok) => {
            if (ok) { if (original.current === null) setEpoch((n) => n + 1); return; }
            setFailed(true);
            restore();
          });
        }}
      />
      {pencilAt && (
        <span className="absolute inline-flex" style={{ left: pencilAt.left, top: pencilAt.top }} data-pencil-overlay>
          <EditPencil onClick={() => ref.current?.focus()} label={pencilLabel} />
        </span>
      )}
      {failed && <p className={cn(SAVE_ERROR_CLASS, "mt-1")} data-testid="check-save-error">{SAVE_FAILED_TEXT}</p>}
    </div>
  );
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-01T16:10:55Z" → "1 October 2026", from the digits (a timezone must not move the day). */
export function longDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** Record tags out, multi-line chip names onto one line. Pure. */
export function cleanBriefingForDisplay(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((https?:\/\/[^\s)"]+\s+"source")\)/g, (_m, name: string, url: string) => `[${name.replace(/\s+/g, " ").trim() || "Source"}](${url})`)
    .replace(/\s*\[r\d+\]/g, "")
    // Trailing spaces before a newline are a Markdown hard break: they put a <br> after a line and pushed the
    // pencil onto a line of its own (dev 2026-10-01). The model writes them; the card does not keep them.
    .replace(/[ \t]+$/gm, "");
}

/** A Google Maps search for the subject's place, the closest thing to "their map": a business by name and place, a person by place. */
export function mapsUrl(location: string, subject: { name: string; type: "person" | "company"; company?: string }): string {
  const business = subject.type === "company" ? subject.name : null;
  const q = [business, location].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function SuggestedByJinna() {
  return (
    <div className="flex items-center" data-testid="check-suggested-by-jinna">
      <ComposerChip icon={<img src={jinnaSphere} alt="" className="h-4 w-4 flex-shrink-0 rounded-full object-cover" />} label="Suggested by Jinna" className="font-normal" />
    </div>
  );
}

/**
 * The card asks (plan §12 step 2, founder "if you recommend it, let's do it"): a finished check
 * with no contact ends with "Add X to your contacts?" and two pills. Yes saves the contact
 * (the same call as the pill) and the row becomes "Added. X is in your contacts."; Not now is
 * remembered on the run so a reload does not ask again. The chat never gets a new turn for
 * it: the run finishes after the turn ended and the card owns the answer.
 */
export function ContactOfferRow({ run, website, linkedin, onSaved, onDismissed }: { run: CheckRun; website?: string; linkedin?: string; onSaved: (contactId: string, name: string) => void; onDismissed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<{ contactId: string; name: string } | null>(null);
  const name = run.owner_edits?.profile?.name?.trim() || run.subject.name;
  // Already a saved contact (exact name): the question is to LINK the report to them, never to add a second one.
  const existing = run.matching_contacts?.length === 1 ? run.matching_contacts[0] : null;
  if (added) {
    return (
      <p className="text-[15px] leading-7 text-foreground" data-testid="check-contact-added">
        {existing ? "Linked. " : "Added. "}<Link to={`/contacts/${added.contactId}`} className="font-semibold text-gray-900 no-underline decoration-dotted decoration-gray-300 underline-offset-2 hover:underline">{added.name}</Link>{existing ? " has this report on their page." : " is in your contacts."}
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="check-contact-offer">
      <p className="text-[15px] leading-7 text-foreground">{existing ? `Link this report to your contact ${existing.name}?` : `Add ${name} to your contacts?`}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={PILL_BUTTON_CLASS}
          disabled={busy}
          data-testid="check-offer-yes"
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              const saved = await saveCheckContact(run.id, { website, linkedin });
              setAdded({ contactId: saved.contact_id, name: existing?.name ?? name });
              onSaved(saved.contact_id, name);
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : failed ? "Try again" : "Yes, add"}
        </button>
        <button
          type="button"
          className={SKIP_PILL_CLASS}
          disabled={busy}
          data-testid="check-offer-no"
          onClick={() => {
            onDismissed();
            void saveCheckEdits(run.id, { contact_offer: "dismissed" }).catch(() => undefined);
          }}
        >
          Not now
        </button>
      </div>
      {failed && <p className="text-xs text-destructive">Could not save the contact.</p>}
    </div>
  );
}

/** "jinna.ai" → "Jinna", "crunchbase.com" → "Crunchbase": a known outlet's name, else the brand word capitalised. */
export function siteLabel(host: string): string {
  if (KNOWN_NAMES[host]) return KNOWN_NAMES[host];
  const brand = brandToken(host);
  return brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : host;
}

/** The owner's own important links (owner_edits.links.extra) as pills: favicon + a known outlet name or the host. */
function ownerLinkPills(edits: OwnerEdits | null | undefined): CheckLinkPill[] {
  return (edits?.links?.extra ?? []).map((link) => {
    const host = hostOf(link.url) ?? "";
    return { platform: "Owner", label: link.label && link.label !== host ? link.label : siteLabel(host), url: link.url, host, kind: "verified" as const };
  });
}

/**
 * The pill row the owner can change: pencil → URL field → saved on Enter or blur; the owner's own
 * important links follow the built pills, and "+ Link" sits with them permanently (founder 2026-10-01).
 * An extra link's pencil opens its URL; emptying it removes the link.
 */
function EditablePills({ pills, editable, edits, onSaveLinks }: { pills: CheckLinkPill[]; editable: boolean; edits: OwnerEdits | null | undefined; onSaveLinks: (links: NonNullable<OwnerEditsPatch["links"]>) => Promise<boolean> }) {
  const [editing, setEditing] = useState<"linkedin" | "website" | { extra: number } | "new" | null>(null);
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(false);
  // Enter saves and the blur that follows must not send the same link twice.
  const saving = useRef(false);
  const extra = edits?.links?.extra ?? [];
  const all = [...pills, ...ownerLinkPills(edits)];
  if (!editable) return <CheckLinkPills pills={all} />;
  const start = (field: "linkedin" | "website") => {
    const current = field === "linkedin" ? edits?.links?.linkedin ?? pills.find((p) => p.platform === "LinkedIn")?.url ?? "" : edits?.links?.website ?? pills.find((p) => p.platform === "Website")?.url ?? "";
    setValue(/google\.[a-z.]+\/search|linkedin\.com\/search/i.test(current) ? "" : current);
    setEditing(field);
  };
  const close = () => { setFailed(false); setEditing(null); };
  const commit = async () => {
    if (!editing || saving.current) return;
    const trimmed = value.trim();
    let patch: NonNullable<OwnerEditsPatch["links"]>;
    if (editing === "new") {
      if (!trimmed) { close(); return; }
      patch = { extra: [...extra, { url: trimmed }] };
    } else if (typeof editing === "object") {
      patch = { extra: extra.map((l, i) => (i === editing.extra ? { ...l, url: trimmed } : l)).filter((l) => l.url.trim()) };
    } else {
      patch = { [editing]: trimmed || null };
    }
    saving.current = true;
    const ok = await onSaveLinks(patch);
    saving.current = false;
    // A refused link (400 invalid_edit) keeps the field open with what was typed, so the owner can fix it.
    if (ok) close();
    else setFailed(true);
  };
  // "+ Link" shows only while the links row is hovered (founder 2026-10-01); touch screens keep it visible.
  const addPill = (
    <button type="button" className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 text-[13px] text-gray-500 opacity-0 transition-opacity hover:border-gray-400 hover:text-gray-700 group-hover/links:opacity-100 focus:opacity-100 max-lg:opacity-100" onClick={() => { setValue(""); setEditing("new"); }} data-testid="check-add-link">
      <Plus className="h-3.5 w-3.5" /> Link
    </button>
  );
  // Each pill is its own hover group: hovering the LinkedIn pill shows only its pencil.
  return (
    <div className="group/links flex flex-wrap items-center gap-2" data-testid="check-link-pills-editable">
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setFailed(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } if (e.key === "Escape") close(); }}
          onBlur={() => void commit()}
          placeholder={editing === "linkedin" ? "https://www.linkedin.com/in/…" : "https://…"}
          className="h-9 w-72 max-w-full rounded-full border border-[#F0F0F0] bg-white px-4 text-[13px] outline-none"
          aria-label={editing === "linkedin" ? "LinkedIn profile address" : editing === "website" ? "Website address" : "Link address"}
          data-testid="check-link-input"
        />
      ) : (
        <>
          {all.map((pill, index) => {
            const extraIndex = index - pills.length;
            const field = pill.platform === "LinkedIn" ? "linkedin" : pill.platform === "Website" ? "website" : extraIndex >= 0 ? { extra: extraIndex } : null;
            return (
              // The pencil floats over the pill's top-right corner so it takes no room: the pills keep their 8px gap.
              <span key={`${pill.platform}-${pill.url}`} className="group/edit relative inline-flex items-center">
                <CheckLinkPills pills={[pill]} />
                {field && (
                  <span className="absolute -right-2 -top-2 rounded-full bg-white opacity-0 shadow-sm transition-opacity group-hover/edit:opacity-100 max-lg:opacity-100">
                    <EditPencil
                      onClick={() => { if (typeof field === "object") { setValue(pill.url); setEditing(field); } else start(field); }}
                      label={field === "linkedin" ? "Change the LinkedIn link" : field === "website" ? "Change the website link" : "Change or remove this link"}
                    />
                  </span>
                )}
              </span>
            );
          })}
          {addPill}
        </>
      )}
      {failed && <p className={cn(SAVE_ERROR_CLASS, "basis-full")} data-testid="check-save-error">{LINK_SAVE_FAILED_TEXT}</p>}
    </div>
  );
}

export interface SurfaceCorner {
  /** Sits on the name's row, right (the contact page's Re-run button). */
  top: ReactNode;
  /** Leads the location's row, left, in the location's type, a double gap before the pin (the researched date). */
  lead?: ReactNode;
}

function ProfileHeading({ name, location, run, editable, onSave, corner }: { name: string; location: string | null; run: CheckRun; editable: boolean; onSave: (profile: NonNullable<OwnerEditsPatch["profile"]>) => Promise<boolean>; corner?: SurfaceCorner }) {
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftLocation, setDraftLocation] = useState(location ?? "");
  const editorRef = useRef<HTMLDivElement>(null);
  const begin = () => { if (!editable) return; setFailed(false); setDraftName(name); setDraftLocation(location ?? ""); setEditing(true); };
  if (editing) {
    // Enter saves, Escape cancels, and leaving the block (not moving between its two fields) saves —
    // dev 2026-10-01: a changed name went nowhere because only Enter committed.
    // The reading state shows the STORED name, so a failed save reads as not kept, with one line saying so.
    const commit = () => { void onSave({ name: draftName.trim() || null, location: draftLocation.trim() || null }).then((ok) => setFailed(!ok)); setEditing(false); };
    // The editor keeps the exact rows of the reading state (same heights, the corner, the lead, the pin), so
    // nothing moves and Re-run stays put when the cursor lands in the name (founder 2026-10-01).
    const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); };
    const fields = (
      <div className="min-w-0 flex-1">
        <div className={cn("flex items-center gap-2", corner && "h-9")}>
          <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={onKey} className={cn(SETTINGS_SECTION_TITLE_CLASS, "w-full bg-transparent p-0 outline-none")} aria-label="Name" data-testid="check-profile-name-input" />
        </div>
        <div className={cn(SETTINGS_SECTION_SUBTITLE_CLASS, "!text-gray-500 flex items-center gap-1.5", corner && "mt-1 h-6")}>
          {corner?.lead && <span className="mr-4 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">{corner.lead}</span>}
          <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          <input value={draftLocation} onChange={(e) => setDraftLocation(e.target.value)} onKeyDown={onKey} placeholder="City, Country" className="min-w-0 flex-1 bg-transparent p-0 outline-none placeholder:text-gray-400" aria-label="Location" />
        </div>
      </div>
    );
    return (
      <div
        ref={editorRef}
        className={cn(corner ? "flex items-start justify-between gap-4" : "")}
        data-testid="check-profile-editor"
        onBlur={(e) => { if (editorRef.current && e.relatedTarget instanceof Node && editorRef.current.contains(e.relatedTarget)) return; commit(); }}
      >
        {fields}
        {corner && <div className="flex h-9 shrink-0 items-center" data-testid="check-surface-corner">{corner.top}</div>}
      </div>
    );
  }
  // Two matched rows: the name's row (h-9, the button's height) and the location's row (h-6), so what
  // sits in the corner lines up with them horizontally (founder 2026-10-01).
  const rows = (
    <div className="group/edit min-w-0">
      <div className={cn("flex items-center gap-2", corner && "h-9")}>
        <h3 className={cn(SETTINGS_SECTION_TITLE_CLASS, location && !corner && "mb-1", "truncate", editable && "cursor-text")} onClick={begin} data-testid="check-profile-name">{name}</h3>
        {editable && <EditPencil onClick={begin} label="Edit the name and location" />}
      </div>
      {(location || corner?.lead) && (
        <p className={cn(SETTINGS_SECTION_SUBTITLE_CLASS, "!text-gray-500 flex items-center gap-1.5", corner && "mt-1 h-6")} data-testid="check-profile-location">
          {corner?.lead && <span className="mr-4 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">{corner.lead}</span>}
          {location && (
            <>
              <a href={mapsUrl(location, run.subject)} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" aria-label="Open in Google Maps" data-testid="check-profile-map" className="inline-flex text-gray-400 transition-colors hover:text-gray-700">
                <MapPin className="h-3.5 w-3.5" />
              </a>
              <span className={cn(editable && "cursor-text")} onClick={begin}>{location}</span>
            </>
          )}
        </p>
      )}
      {failed && <p className={cn(SAVE_ERROR_CLASS, "mt-1")} data-testid="check-save-error">{SAVE_FAILED_TEXT}</p>}
    </div>
  );
  if (!corner) return <div>{rows}</div>;
  return (
    <div className="flex items-start justify-between gap-4">
      {rows}
      <div className="flex h-9 shrink-0 items-center" data-testid="check-surface-corner">{corner.top}</div>
    </div>
  );
}

const CORNER_BUTTON_CLASS = "inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background no-underline transition-colors hover:bg-foreground/90 disabled:opacity-50";

/**
 * The contact button in the surface's top-right corner (founder 2026-10-01): black like Re-run. "Your Contact"
 * opens the contact page when the check belongs to a contact; "+ Add Contact" saves the subject as one.
 */
function ContactCornerButton({ run, website, linkedin, onSaved }: { run: CheckRun; website?: string; linkedin?: string; onSaved: (contactId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (run.contact_id) {
    // The previous design, kept (founder 2026-10-01): the grey chip with the tick, now in the corner.
    return (
      <Link to={`/contacts/${run.contact_id}`} className="no-underline" data-testid="check-contact-link">
        <ComposerChip icon={<Check className="h-4 w-4 text-[#858481]" />} label="Your Contact" className="h-9 cursor-pointer font-normal transition-colors hover:bg-[#FAFAFA]" />
      </Link>
    );
  }
  // Several saved contacts share the name: linking would be a guess and adding a duplicate — no button.
  if ((run.matching_contacts?.length ?? 0) > 1) return null;
  // The subject is already a saved contact (exact name): link the report to them, never create a second one.
  const linking = run.matching_contacts?.length === 1;
  return (
    <button
      type="button"
      disabled={busy}
      className={CORNER_BUTTON_CLASS}
      title={linking ? `Link this report to your contact ${run.matching_contacts![0].name}` : undefined}
      data-testid="check-save-contact"
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        try {
          const saved = await saveCheckContact(run.id, { website, linkedin });
          onSaved(saved.contact_id);
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {linking ? <Link2 className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
      {failed ? "Try again" : busy ? (linking ? "Linking…" : "Adding…") : linking ? "Link Contact" : "Add Contact"}
    </button>
  );
}

export interface CheckBriefingViewProps {
  run: CheckRun;
  /** Pencils on every section, pill and profile line; edits save through PATCH /runs/:id/edits. */
  editable?: boolean;
  /** Show "Add X to your contacts?" under the report when the run has no contact (the chat card). */
  offerContact?: boolean;
  /** Called with the saved edits after every successful save. */
  onEdits?: (edits: OwnerEdits | null) => void;
  onContactSaved?: (contactId: string) => void;
  /** The surface's top-right corner on the name's row, and a lead on the location's row (the contact page's Re-run button and the researched date). */
  corner?: SurfaceCorner;
  /** The contact page already IS the contact: no "In your contacts" / "Save as contact" pill there. */
  hideContactPill?: boolean;
}

export function CheckBriefingView({ run, editable = false, offerContact = false, onEdits, onContactSaved, corner, hideContactPill = false }: CheckBriefingViewProps) {
  const [edits, setEdits] = useState<OwnerEdits | null>(run.owner_edits ?? null);
  const [offerHidden, setOfferHidden] = useState(false);
  // The offer row stays after a Yes to show "Added. X is in your contacts." (the contact id alone would hide it).
  const [addedViaOffer, setAddedViaOffer] = useState(false);
  const [contactId, setContactId] = useState<string | null>(run.contact_id);

  // True when the server kept the change; each editor shows its own failure line and puts the stored text back.
  const save = async (patch: OwnerEditsPatch): Promise<boolean> => {
    try {
      const saved = await saveCheckEdits(run.id, patch);
      setEdits(saved.owner_edits);
      onEdits?.(saved.owner_edits);
      return true;
    } catch (error: unknown) {
      console.warn("[checkcheck] edit not saved:", error instanceof Error ? error.message : "unknown error");
      return false;
    }
  };

  if (!run.briefing_text) return null;
  const liveRun: CheckRun = { ...run, owner_edits: edits, contact_id: contactId };
  // The text as the card reads it: record tags ("[r2]", the app's register records) are chips' business, not prose;
  // a source chip whose name spans lines (a page title with a newline) is pulled back onto one line.
  const briefing = cleanBriefingForDisplay(run.briefing_text);
  const rawSections = splitBriefingSections(briefing).filter((s) => !isSourcesSection(s.title) && !(s.title && LINKS_SECTION_TITLE.test(s.title)));
  const sections = applyEditsToSections(rawSections, edits);
  const validation = run.validation as { decisions?: Array<{ final?: string | null }>; entities?: { people?: string[]; companies?: string[] } } | null | undefined;
  const decisions = validation?.decisions;
  // The pages the run read (the app's Sources list in the stored text) feed the pills and the company links.
  const sourcePages = parseSourcePages(briefing);
  const textNames = namesInText(briefing);
  const companyLinks = buildCompanyLinkIndex(briefing, [...(decisions ?? []).map((d) => d.final), ...sourcePages.map((s) => s.url)]);
  const pillsHost = sections.find((s) => isProfileSection(s.title)) ?? null;
  // The LinkedIn pill is labelled with the report's own Name line (proper case) or the owner's edit, never the typed form.
  const displayName = edits?.profile?.name?.trim() || (pillsHost ? extractProfileHeading(pillsHost.body).name : null) || run.subject.name;
  const builtPills = buildCheckLinkPills({ subject: { ...run.subject, name: displayName }, finals: (decisions ?? []).map((d) => d.final), sources: sourcePages, textNames, companies: roleCompanies(pillsHost?.body ?? "") });
  // The owner's own LinkedIn / site links replace the built pills (plan §12 step 3).
  const linkPills: CheckLinkPill[] = builtPills.map((p) => {
    const override = p.platform === "LinkedIn" ? edits?.links?.linkedin : p.platform === "Website" ? edits?.links?.website : null;
    if (!override) return p;
    let host = p.host;
    try { host = new URL(override).hostname.replace(/^www\./, ""); } catch { /* keep */ }
    // A site pill pointed at another company's site takes that site's name (dev 2026-10-01: the favicon changed, the old name stayed).
    const label = p.platform === "Website" && !hostBelongsTo(host, companyTokens(p.label)) ? siteLabel(host) : p.label;
    return { ...p, url: override, kind: "verified", host, label };
  });
  const identityHosts = linkPills.map((p) => p.host);
  const entityLinks = buildEntityLinks(validation?.entities, run.subject, roleCompanies(pillsHost?.body ?? ""), companyLinks);
  const outletEntityLinks = [...outletLinks(textNames, sourcePages).map((o) => ({ name: o.name, url: o.url })), ...entityLinks].filter((l, i, all) => all.findIndex((x) => x.name.toLowerCase() === l.name.toLowerCase()) === i);
  const verifiedWebsite = linkPills.find((p) => p.platform === "Website" && p.kind === "verified")?.url;
  const verifiedLinkedIn = linkPills.find((p) => p.platform === "LinkedIn" && p.kind === "verified")?.url;
  const showOffer = offerContact && (!contactId || addedViaOffer) && !offerHidden && edits?.contact_offer !== "dismissed" && (run.matching_contacts?.length ?? 0) <= 1;
  // The chat card's corner holds the contact button; the contact page passes its own corner (Re-run) and hides it.
  // The chat card's corner: the contact button top-right and the researched date before the location (the
  // contact page passes its own, with Re-run). A bare date is formatted from its digits, never through a Date.
  const researchedOn = run.completed_at ? longDate(run.completed_at) : null;
  const researchedLead = researchedOn ? (
    <>
      <Search className="h-3.5 w-3.5 text-gray-400" aria-hidden />
      <span data-testid="check-researched-date">{researchedOn}</span>
    </>
  ) : undefined;
  const cornerToUse: SurfaceCorner | undefined = corner ?? (!hideContactPill
    ? { top: <ContactCornerButton run={liveRun} website={verifiedWebsite} linkedin={verifiedLinkedIn} onSaved={(id) => { setContactId(id); onContactSaved?.(id); }} />, lead: researchedLead }
    : undefined);

  return (
    <>
    <section className={cn(SECTION_CLASS, "space-y-6")} data-testid="check-briefing-surface">
      {run.status === "partial" && (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Partial result: the answer was cut short before the end. Links in it were still checked.</p>
      )}
      {sections.map((section, index) => {
        const key = sectionKey(section.title);
        const heading = section === pillsHost ? extractProfileHeading(section.body) : null;
        const inBrief = isInBriefSection(section.title);
        const title = heading ? heading.name ?? run.subject.name : inBrief ? null : section.title;
        const body = heading
          ? tidyProfileBody(linkifyRoleCompanies(stripLinksLines(heading.body), companyLinks))
          : boldNumbers(chipifySourceLinks(linkifyEntities(reflowParagraphs(section.body), outletEntityLinks), sourcePages, identityHosts, textNames, entityLinks.map((l) => l.name)));
        const onSurface = section === pillsHost;
        return (
          <div key={`${section.title ?? "untitled"}-${index}`} className={cn("space-y-4", !onSurface && "group/edit")} data-briefing-section={section.title ?? ""} data-edited={section.edited ? "true" : undefined}>
            {heading ? (
              <ProfileHeading name={title ?? run.subject.name} location={heading.location} run={liveRun} editable={editable} onSave={(profile) => save({ profile })} corner={cornerToUse} />
            ) : title ? (
              <h3 className={SETTINGS_SECTION_TITLE_CLASS}>{title}</h3>
            ) : null}
            {onSurface ? (
              (body || linkPills.length > 0 || editable) && (
                <div className="space-y-4" data-testid="check-profile-body">
                  {body ? (
                    editable ? (
                      // The role line edited in place: the current role alone, no label, no previous role (founder 2026-10-01);
                      // saving writes it back as the Current role line and drops the Previous role line. Name, Location and
                      // Links lines are kept around it (withProfileFrame).
                      <EditableProse key={section.body} paragraphs={[body]} className={cn("group/edit", BRIEFING_PROSE_CLASS)} pencilLabel="Edit the role line" testId="check-role-line" onSave={(text) => save({ sections: { [key]: withProfileFrame(section.body, text.trim() ? `Current role: ${text.trim()}` : "") } })} />
                    ) : (
                      <div data-testid="check-role-line"><MarkdownContent content={body} className={BRIEFING_PROSE_CLASS} /></div>
                    )
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <EditablePills pills={linkPills} editable={editable} edits={edits} onSaveLinks={(links) => save({ links })} />
                  </div>
                </div>
              )
            ) : (
              body && (
                <div className={INNER_CARD_CLASS} data-testid={inBrief ? "check-in-brief" : undefined}>
                  <BriefingProse
                    key={section.body}
                    markdown={body}
                    trailer={isConnectionSection(section.title) ? <SuggestedByJinna /> : undefined}
                    onSaveText={editable ? (text) => save({ sections: { [key]: joinProseAndChips(text, splitProseAndChips(section.body).chips) } }) : undefined}
                    modifiedOn={section.edited && edits?.edited_at ? new Date(edits.edited_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null}
                  />
                </div>
              )
            )}
          </div>
        );
      })}
      {!pillsHost && linkPills.length > 0 && (
        <div className="space-y-4">
          <h3 className={SETTINGS_SECTION_TITLE_CLASS}>Links</h3>
          <EditablePills pills={linkPills} editable={editable} edits={edits} onSaveLinks={(links) => save({ links })} />
        </div>
      )}
    </section>
    {showOffer && (
      // Jinna's question in the chat, under the card, not inside the report (founder 2026-10-01): plain
      // assistant text with quick-reply pills, the way every other server-worded question reads.
      <div className="px-1" data-testid="check-contact-offer-message">
        <ContactOfferRow run={liveRun} website={verifiedWebsite} linkedin={verifiedLinkedIn} onSaved={(id) => { setAddedViaOffer(true); setContactId(id); onContactSaved?.(id); }} onDismissed={() => setOfferHidden(true)} />
      </div>
    )}
    </>
  );
}
