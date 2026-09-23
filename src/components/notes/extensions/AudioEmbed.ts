import { Node, mergeAttributes } from "@tiptap/core";
import { safeEmbedSrc } from "@/lib/safe-url";

/**
 * Audio embed node for TipTap.
 * Renders as an <audio> element with controls.
 * Markdown output: `![audio](url)` — Obsidian-compatible.
 */
export const AudioEmbed = Node.create({
  name: "audioEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "audio[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "embed-audio-wrapper" },
      [
        "audio",
        mergeAttributes({
          src: safeEmbedSrc(HTMLAttributes.src),
          controls: "true",
          preload: "metadata",
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setAudioEmbed:
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
