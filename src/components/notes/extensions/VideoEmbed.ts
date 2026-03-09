import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Video embed node for TipTap.
 * Supports YouTube, Vimeo iframes and direct video URLs.
 * Markdown output: `![video](url)` — Obsidian-compatible.
 */
export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      { tag: "iframe[data-type='video']" },
      { tag: "video[src]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src || "";
    const isIframe = /youtube|youtu\.be|vimeo|dailymotion/.test(src);

    if (isIframe) {
      const embedUrl = toEmbedUrl(src);
      return [
        "div",
        { class: "embed-video-wrapper" },
        [
          "iframe",
          mergeAttributes(
            {
              src: embedUrl,
              frameborder: "0",
              allowfullscreen: "true",
              allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
              "data-type": "video",
            },
            { title: HTMLAttributes.title }
          ),
        ],
      ];
    }

    return [
      "div",
      { class: "embed-video-wrapper" },
      [
        "video",
        mergeAttributes({ src, controls: "true", preload: "metadata" }),
      ],
    ];
  },

  addCommands() {
    return {
      setVideoEmbed:
        (attrs: { src: string; title?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    } as any;
  },
});

/** Convert watch URLs to embed URLs */
function toEmbedUrl(url: string): string {
  // YouTube
  let match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/
  );
  if (match) return `https://www.youtube.com/embed/${match[1]}`;

  // Vimeo
  match = url.match(/vimeo\.com\/(\d+)/);
  if (match) return `https://player.vimeo.com/video/${match[1]}`;

  return url;
}
