/** Replace NEXT_PUBLIC_SITE_URL with the approved production origin before launch. */
const PLACEHOLDER_SITE_URL = "https://replace-before-launch.invalid";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || PLACEHOLDER_SITE_URL).replace(/\/$/, "");
export const SITE_URL_IS_PLACEHOLDER = SITE_URL === PLACEHOLDER_SITE_URL;
