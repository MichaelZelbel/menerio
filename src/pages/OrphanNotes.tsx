import { OrphanNotesDetector } from "@/components/graph/OrphanNotesDetector";

export default function OrphanNotes() {
  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Orphan Notes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-visible notes with no connections yet. Use <strong>Find</strong> to
          let AI suggest links, or click a note to add wikilinks manually.
        </p>
      </div>
      <OrphanNotesDetector />
    </div>
  );
}
