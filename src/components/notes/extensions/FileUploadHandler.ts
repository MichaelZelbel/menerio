import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { uploadAttachment, validateFile, detectMediaType, type MediaType } from "@/lib/upload-attachment";
import { supabase } from "@/integrations/supabase/client";

/**
 * TipTap extension that handles drag-and-drop and paste file uploads.
 * Uploads to Supabase Storage, inserts the correct embed node,
 * and triggers media analysis for images and PDFs.
 */
export const FileUploadHandler = Extension.create({
  name: "fileUploadHandler",

  addOptions() {
    return {
      userId: "" as string,
      noteId: "" as string,
      onUploadStart: (() => {}) as () => void,
      onUploadEnd: (() => {}) as () => void,
      onUploadError: ((_msg: string) => {}) as (msg: string) => void,
    };
  },

  addProseMirrorPlugins() {
    const { userId, noteId, onUploadStart, onUploadEnd, onUploadError } = this.options;
    const editor = this.editor;

    const triggerMediaAnalysis = async (
      storagePath: string,
      mediaType: MediaType,
      originalFilename: string
    ) => {
      try {
        if (!noteId) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const functionName = mediaType === "pdf" ? "analyze-pdf" : "analyze-media";
        await supabase.functions.invoke(functionName, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: {
            note_id: noteId,
            storage_path: storagePath,
            media_type: mediaType === "pdf" ? "pdf" : "image",
            original_filename: originalFilename,
          },
        });
      } catch (e) {
        console.warn("Media analysis trigger failed:", e);
      }
    };

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
          const { url, mediaType, storagePath } = await uploadAttachment(file, userId);
          insertMedia(url, mediaType);

          // Trigger analysis for images and PDFs
          if (mediaType === "image" || mediaType === "pdf") {
            triggerMediaAnalysis(storagePath, mediaType, file.name);
          }
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
