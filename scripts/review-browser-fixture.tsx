import React from "react";
import { createRoot } from "react-dom/client";
import { useQuery } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext";
import { readRecovery, writeRecovery, withRecoveryLock } from "../src/sync/recovery";

function PrivateData() {
  const { user, profile } = useAuth();
  const group = useQuery({ queryKey: ["contact_group", "friends"], enabled: !!user, queryFn: async () => {
    if (sessionStorage.getItem("fixture-offline")) throw new Error("Synthetic offline request");
    return `${user!.id} private group`;
  } });
  const note = useQuery({ queryKey: ["note", "bookmark"], enabled: !!user, queryFn: async () => {
    if (sessionStorage.getItem("fixture-offline")) throw new Error("Synthetic offline request");
    return `${user!.id} private note`;
  } });
  return <main><div id="owner">{user?.id ?? "signed-out"}</div><div id="group">{user ? group.data : ""}</div>
    <div id="note">{user ? note.data : ""}</div><div id="profile">{profile?.display_name}</div></main>;
}
(window as any).recoveryFixture = { readRecovery, writeRecovery, withRecoveryLock };
createRoot(document.getElementById("root")!).render(<AuthProvider><PrivateData /></AuthProvider>);
