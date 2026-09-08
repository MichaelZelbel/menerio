import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { readRecovery, type RecoveryBatch } from "./recovery";
import { SupabaseConnector } from "./connector";

export function RecoveryNotice() {
  const { user } = useAuth();
  const userId = user?.id;
  const [snapshot, setSnapshot] = useState<{ owner: string; batches: RecoveryBatch[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (!userId) return;
    const refresh = () => void readRecovery(userId).then(batches => {
      if (active) setSnapshot({ owner: userId, batches: batches.filter(batch => batch.status === "recovery") });
    }).catch(() => { if (active) setError("Saved changes could not be read. Please keep this device's app data."); });
    refresh();
    window.addEventListener("menerio-recovery-change", refresh);
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("menerio-recovery-change", refresh); };
  }, [userId]);
  const batches = snapshot?.owner === user?.id ? snapshot?.batches ?? [] : [];
  if (!user || (!batches.length && !error)) return null;
  const retry = async () => {
    setBusy(true);
    try { await new SupabaseConnector(user.id).retryRecovery(); setError(""); }
    catch { setError("Retry did not finish. Your saved changes are still on this device."); }
    finally { setBusy(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, userId: user.id, batches }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "menerio-saved-changes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside role="alert" className="fixed bottom-16 left-1/2 z-50 w-[min(92vw,36rem)] -translate-x-1/2 rounded-lg border border-destructive bg-background p-4 text-sm shadow-lg">
    <p>{batches.length} group{batches.length === 1 ? "" : "s"} of changes need attention. They are saved on this device.</p>
    <p>{batches.some(batch => batch.kind === "schema") ? "A server update is needed before these changes can upload." : "Check the affected records and your access, then retry. Export keeps a separate copy of the original changes."}</p>
    <details><summary>Show affected changes</summary><ul className="max-h-40 overflow-auto">{batches.map(batch => <li key={batch.id}>
      {String(batch.operations[batch.completed]?.opData?.title ?? batch.operations[batch.completed]?.id ?? "Saved change")} ({batch.kind}{batch.code ? `: ${batch.code}` : ""}), {batch.operations.length - batch.completed} pending
    </li>)}</ul></details>
    {error && <p>{error}</p>}
    <button className="mr-4 underline" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Retry saved changes"}</button>
    <button className="underline" disabled={!batches.length} onClick={download}>Export saved changes</button>
  </aside>;
}
