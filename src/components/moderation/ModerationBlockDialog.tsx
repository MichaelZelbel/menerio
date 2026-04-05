import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ShieldAlert } from "lucide-react";

interface ModerationBlockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
  category?: string;
  supportHint?: string;
}

export function ModerationBlockDialog({
  isOpen,
  onClose,
  reason,
  category,
  supportHint,
}: ModerationBlockDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Content Blocked
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>{reason || "This content violates our Community Guidelines and cannot be shared publicly."}</p>
              {category && (
                <p className="text-xs text-muted-foreground">
                  Category: <span className="font-medium capitalize">{category}</span>
                </p>
              )}
              {supportHint && (
                <p className="text-xs text-muted-foreground">{supportHint}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Please review our{" "}
                <a href="/terms" className="underline text-primary">
                  Community Guidelines
                </a>{" "}
                for more information.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Understood</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
