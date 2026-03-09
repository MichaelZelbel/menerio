import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { uploadAttachment, validateFile, detectMediaType, type MediaType } from "@/lib/upload-attachment";

/**
 * TipTap extension that handles drag-and-drop and paste file uploads.
 * Uploads to Supabase Storage and inserts the correct embed node.
 */
export const FileUploadHandler = Extension.create({
  name: "fileUploadHandler",

  addOptions() {
    return {
      userId: "" as string,
      onUploadStart: (() => {}) as () => void,
      onUploadEnd: (() => {}) as () => void,
      onUploadError: ((_msg: string) => {}) as (msg: string) => void,
    };
  },

  addProseMirrorPlugins() {
    const { userId, onUploadStart, onUploadEnd, onUploadError } = this.options;
    const editor = this.editor;

    const insertMedia = (url: string, mediaType: MediaType) => {
      switch (mediaType) {
        case "image":
          editor.chain().focus().setImage({ src: url }).run();
          break;
        case "video":
          (editor.commands as any).setVideoEmbed({ src: url });
          break;
        case "audio":
          (editor.commands as any).setAudioEmbed({ src: url });
          break;
        case "pdf":
          (editor.commands as any).setPdfEmbed({ src: url });
          break;
      }
    };

    const handleFiles = async (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (!fileArr.length || !userId) return;

      for (const file of fileArr) {
        const err = validateFile(file);
        if (err) {
          onUploadError(err);
          continue;
        }

        onUploadStart();
        try {
          const { url, mediaType } = await uploadAttachment(file, userId);
          insertMedia(url, mediaType);
        } catch (e: any) {
          onUploadError(e.message || "Upload failed");
        } finally {
          onUploadEnd();
        }
      }
    };

    return [
      new Plugin({
        key: new PluginKey("fileUploadHandler"),
        props: {
          handleDrop(view, event) {
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;

            // Only handle if at least one file is a supported media type
            const supported = Array.from(files).some(
              (f) => detectMediaType(f) !== "unknown"
            );
            if (!supported) return false;

            event.preventDefault();
            handleFiles(files);
            return true;
          },
          handlePaste(view, event) {
            const files = event.clipboardData?.files;
            if (!files?.length) return false;

            const supported = Array.from(files).some(
              (f) => detectMediaType(f) !== "unknown"
            );
            if (!supported) return false;

            event.preventDefault();
            handleFiles(files);
            return true;
          },
        },
      }),
    ];
  },
});
