import type { ReactNode } from "react";
import { createElement, Fragment } from "react";

// Matches http(s):// URLs, www. URLs, and email addresses.
const LINKIFY_REGEX =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

function isEmail(token: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
}

function buildHref(token: string) {
  if (isEmail(token)) return `mailto:${token}`;
  if (token.startsWith("www.")) return `https://${token}`;
  return token;
}

/**
 * Splits text into React nodes, turning URLs and emails into clickable links.
 * Safe from XSS — output is React nodes, never raw HTML.
 */
export function linkifyText(text: string): ReactNode {
  if (!text) return text;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(LINKIFY_REGEX)) {
    const matchIndex = match.index ?? 0;
    let token = match[0];
    let trailing = "";

    const trailingMatch = token.match(TRAILING_PUNCTUATION);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      token = token.slice(0, -trailing.length);
    }

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    parts.push(
      createElement(
        "a",
        {
          key: `link-${key++}`,
          href: buildHref(token),
          target: "_blank",
          rel: "noreferrer noopener",
          className: "text-primary hover:underline break-all",
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
        token,
      ),
    );

    if (trailing) parts.push(trailing);

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return createElement(Fragment, null, ...parts);
}
