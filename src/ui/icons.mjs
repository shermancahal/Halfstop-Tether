/*
 * One drawing per intent, at the size of a fingernail.
 *
 * Line art, no fill, `currentColor` throughout, so a card decides its own
 * colour and the disabled ones grey out with everything else. Each is the
 * shape of the thing rather than a symbol for it: a waterfall falls, star
 * trails circle the pole, a timelapse is frames in a row. A photographer
 * choosing in the dark should not have to read.
 */

const SVG = (body) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${body}</svg>`;

export const ICONS = {
  /* Water over a lip, two more falls behind it, broken water below. */
  waterfall: SVG(`
    <path d="M3 5h3.5A3.5 3.5 0 0 1 10 8.5V16"/>
    <path d="M14 7.5V16"/>
    <path d="M18 10V16"/>
    <path d="M2 19.5c1.7-1.2 3.3-1.2 5 0s3.3 1.2 5 0 3.3-1.2 5 0"/>`),

  /* A light trail: one long smear and the ground it was shot from. */
  'long-exposure': SVG(`
    <path d="M2 14.5c4 0 5.5-7 11-7 3.4 0 5.6 3 9 3"/>
    <path d="M3 19h11"/>
    <circle cx="21.2" cy="10.4" r="1.1"/>`),

  /* The band, on the diagonal it actually runs, with stars in it. */
  'milky-way': SVG(`
    <path d="M2 21C6 14.5 12.5 8 21 3.5"/>
    <path d="M7.5 22.5C11 16.5 16.5 11 22.5 7.5"/>
    <circle cx="9.5" cy="13.5" r=".85"/>
    <circle cx="14.5" cy="9" r=".7"/>
    <circle cx="17.5" cy="13" r=".7"/>`),

  /* Trails turn about the pole, so the pole is the centre. */
  astro: SVG(`
    <circle cx="12" cy="12" r=".9"/>
    <path d="M12 8.5A3.5 3.5 0 0 1 15.5 12"/>
    <path d="M12 5.5A6.5 6.5 0 0 1 18.5 12"/>
    <path d="M12 2.5A9.5 9.5 0 0 1 21.5 12"/>`),

  /* Half a sun on the horizon is the only time this light exists. */
  'golden-hour': SVG(`
    <path d="M2 18.5h20"/>
    <path d="M7 18.5a5 5 0 0 1 10 0"/>
    <path d="M12 4.5v2M5.8 7.3l1.4 1.4M18.2 7.3l-1.4 1.4M2.5 13.5h2M19.5 13.5h2"/>`),

  /* Frames on a clock: kept as frames, which is the whole distinction. */
  intervalometer: SVG(`
    <circle cx="12" cy="12" r="8.5"/>
    <path d="M12 7v5l3.2 2"/>`),

  /* Frames in a row, assembled: the strip, not the clock. */
  timelapse: SVG(`
    <rect x="2.5" y="7" width="19" height="10" rx="1.6"/>
    <path d="M9 7v10M15 7v10"/>
    <path d="M5.2 4.5h1.2M11.2 4.5h1.2M17.2 4.5h1.2"/>
    <path d="M5.2 19.5h1.2M11.2 19.5h1.2M17.2 19.5h1.2"/>`),
};

export function iconFor(id) {
  return ICONS[id] ?? '';
}
