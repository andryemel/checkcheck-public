import { TODO_CARD_SURFACE_CLASS } from '@/components/todo/todoCardSurface';

/**
 * Settings section shell. Same radius and fill as a To Do column and a
 * homepage widget section (`rounded-3xl bg-stone-50`).
 *
 * Horizontal padding is the previous `p-4` / `sm:p-6` inset, increased by
 * 50% (16px → 24px, 24px → 36px). Vertical padding stays as it was.
 */
export const SETTINGS_SECTION_CLASS =
  'min-w-0 rounded-3xl bg-stone-50 px-6 pt-4 pb-5 sm:px-9 sm:pt-6 sm:pb-[30px]';

/**
 * Memory section on phones: 2–3× tighter inset than SETTINGS_SECTION_CLASS
 * (24px → 8px, 16px → 6px) and a smaller corner. `md+` keeps the shared shell.
 */
export const SETTINGS_MEMORY_SECTION_CLASS =
  `${SETTINGS_SECTION_CLASS} max-md:!px-2 max-md:!py-1.5 max-md:!rounded-xl`;

/**
 * Memory facts card only. Same chrome as a To Do board card, with 25% more
 * left padding (16px → 20px, 24px → 30px) so the avatar sits further from
 * the edge.
 */
export const SETTINGS_MEMORY_CARD_CLASS =
  `${TODO_CARD_SURFACE_CLASS} min-w-0 py-4 pr-4 pl-5 sm:py-6 sm:pr-6 sm:pl-[30px]`;

/**
 * Same left inset as SETTINGS_MEMORY_CARD_CLASS on phones only, so titles
 * line up with the logo. Web (`md+`) is untouched.
 */
export const SETTINGS_MEMORY_HEADER_INSET_CLASS =
  'max-md:pl-5 sm:max-md:pl-[30px]';

/**
 * Section title — same type as Memory's "Business Memory" / "Contacts Memory".
 */
export const SETTINGS_SECTION_TITLE_CLASS = 'text-lg font-semibold';

/**
 * Section subtitle — same type as Memory's gray description under the title
 * (also the Settings "Saved" pill).
 */
export const SETTINGS_SECTION_SUBTITLE_CLASS = 'text-xs font-normal text-gray-400';

/**
 * Single-line fields — same pill as the home composer (fully rounded, #E0E0E0
 * border, soft shadow, #B9B9B7 placeholder, black focus ring).
 * `block w-full min-w-0` so the pill never shrinks to the text length.
 */
export const SETTINGS_INPUT_CLASS =
  'block h-10 w-full min-w-0 rounded-full border border-[#E0E0E0] bg-white pl-[1.2rem] pr-4 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)] placeholder:text-[#B9B9B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-0';

/**
 * Multi-line fields — same box as the home composer when it grows past one
 * line (rounded-2xl, same border / shadow / placeholder / focus).
 */
/**
 * The Save button drawn INSIDE a settings input, bottom right (founder 2026-09-24: shown only
 * while there is something to save; one size for the one-line box and the text area).
 */
export const SETTINGS_INLINE_SAVE_CLASS =
  'absolute right-1 flex h-8 items-center rounded-full bg-black px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40';

export const SETTINGS_TEXTAREA_CLASS =
  'block w-full min-w-0 min-h-[80px] rounded-2xl border border-[#E0E0E0] bg-white py-3 pl-[1.2rem] pr-4 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)] placeholder:text-[#B9B9B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-0';

/**
 * Business Description / Summary / Ideal Customers — grows with the text from
 * one input line up to 128px (`field-sizing: content`), and the corner grip
 * (`resize-y`) lets the user enlarge within that range. Scrollbar hidden.
 */
export const SETTINGS_PROFILE_TEXTAREA_CLASS =
  'block w-full min-w-0 min-h-10 max-h-[128px] resize-y overflow-y-auto rounded-2xl border border-[#E0E0E0] bg-white py-2.5 pl-[1.2rem] pr-4 text-sm leading-snug shadow-[0_1px_3px_rgba(0,0,0,0.05)] placeholder:text-[#B9B9B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-0 [field-sizing:content] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

/** Cap for SETTINGS_PROFILE_TEXTAREA_CLASS auto-grow / manual resize (px). */
export const SETTINGS_PROFILE_TEXTAREA_MAX_PX = 128;
