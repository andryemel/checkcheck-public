/**
 * Card chrome: rounded-3xl, solid white, soft mid shadow, 1px super-light grey border.
 */
export const TODO_CARD_SURFACE_CLASS =
  'rounded-3xl border border-gray-100 bg-white shadow-[0_4px_6px_-1px_rgb(0_0_0/0.035),0_2px_4px_-2px_rgb(0_0_0/0.035)]';

/**
 * Board card inset (~2.5× the original 20/3.6/7.2 so title and avatar
 * aren't flush to the rounded edge). Menu `right` must match `pr`.
 */
export const TODO_CARD_PAD_CLASS = 'py-10 pl-9 pr-5';
export const TODO_CARD_MENU_RIGHT_CLASS = 'right-5';

/**
 * Live WorkItemCard primary-row layout. Empty placeholders reuse these so
 * avatar, gutter, gap, inset, and two-line height stay aligned with real cards.
 */
/**
 * Below lg (2026-09-07) the pad grows so a two-line card / placeholder is
 * 128px (= the phone widget height) and a one-line card ~108px:
 * 29.75 + 38.5 + 6 + 22 + 29.75 + 2 border = 128. lg+ keeps py-5 (108.5).
 */
export const TODO_CARD_V_PAD_CLASS = 'py-5 max-lg:py-[29.75px]';
export const TODO_CARD_H_INSET_CLASS = 'pl-[3.6px] pr-[7.2px]';
export const TODO_CARD_GRIP_GUTTER_CLASS = 'w-[18px] shrink-0';
export const TODO_CARD_AVATAR_SIZE_CLASS = 'h-9 w-9';
/**
 * Two-line title slot: text-sm × leading-snug × 2 (TodoClampExpandText
 * default) = 14px × 1.375 × 2 = 38.5px. Pixel value on purpose — an `em`
 * here resolved against the inherited 16px in the empty placeholder (no
 * text-sm on the spacer) and made it 5.5px taller than a real two-line card.
 */
export const TODO_CARD_TITLE_TWO_LINE_MIN_H_CLASS = 'min-h-[38.5px]';
/** Badge / due-date row under the title. */
export const TODO_CARD_META_ROW_CLASS = 'mt-1.5 min-h-[22px]';
export const TODO_CARD_PRIMARY_ROW_GAP_CLASS = 'gap-4';
/** Where a card's copy starts: inset 3.6 + grip 18 + avatar 36 + row gap 16. */
export const TODO_CARD_TEXT_LEFT_CLASS = 'left-[73.6px]';
