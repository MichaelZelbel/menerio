import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Check, Minus } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { brandLogo } from "@/lib/brand-assets";
import { answerConnectRequest, getConnectRequest, type HubConnectRequest } from "@/lib/hub-connect";

/**
 * The page a hub sends its owner to: "this hub wants to connect, is that you?"
 *
 * The hub started the request and is waiting. This page shows who is asking and
 * for what, the person compares the code with the one their hub shows, and says
 * yes or no. No key is shown here or anywhere: the hub collects it by itself
 * once the answer is yes.
 */

type View =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "confirm"; request: HubConnectRequest }
  | { kind: "approved"; hubName: string }
  | { kind: "denied"; tooManyTries: boolean }
  | { kind: "error"; message: string };

export default function ConnectHub() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const codeFromLink = searchParams.get("code") ?? "";

  const [view, setView] = useState<View>({ kind: "loading" });
  // The link normally carries the code. Without it, or once it turned out to be
  // wrong, the person types what their hub shows instead.
  const [askForCode, setAskForCode] = useState(!codeFromLink);
  const [typedCode, setTypedCode] = useState("");
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [answering, setAnswering] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!requestId) {
      setView({ kind: "gone" });
      return;
    }
    (async () => {
      const res = await getConnectRequest(requestId);
      if (cancelled) return;
      if (res.ok && res.data) setView({ kind: "confirm", request: res.data });
      else if (res.status === 404) setView({ kind: "gone" });
      else setView({ kind: "error", message: res.message });
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const answer = async (approve: boolean) => {
    if (view.kind !== "confirm") return;
    const code = askForCode ? typedCode : codeFromLink;
    setAnswering(approve ? "yes" : "no");
    setCodeProblem(null);
    const res = await answerConnectRequest(requestId, code, approve);
    setAnswering(null);

    if (res.ok && res.data) {
      setView(res.data.status === "approved"
        ? { kind: "approved", hubName: view.request.hub_name }
        // Asked for yes and told no: the code was wrong one time too many.
        : { kind: "denied", tooManyTries: approve });
      return;
    }
    if (res.code === "wrong_code") {
      setAskForCode(true);
      const left = res.attemptsLeft;
      setCodeProblem(
        `That code does not match.${typeof left === "number" ? ` ${left} ${left === 1 ? "try" : "tries"} left.` : ""}`,
      );
      return;
    }
    if (res.status === 404) setView({ kind: "gone" });
    else setView({ kind: "error", message: res.message });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <SEOHead title="Connect your hub - Menerio" noIndex />
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <img src={brandLogo} alt={BRAND.name} className="h-10 w-10 object-contain" />
          </Link>
          <h1 className="text-2xl font-bold font-display">Connect your hub</h1>
        </div>

        {view.kind === "loading" && (
          <Card>
            <CardContent className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
            </CardContent>
          </Card>
        )}

        {view.kind === "gone" && (
          <Message
            icon={<Clock className="h-8 w-8 text-muted-foreground" />}
            title="This request is not open"
            body={
              requestId
                ? "It may have expired, been answered already, or been opened with a different account. Requests last ten minutes. Start again from your hub."
                : `This page opens from your hub. Tell your hub assistant: connect ${BRAND.name}.`
            }
          />
        )}

        {view.kind === "error" && (
          <Message
            icon={<AlertTriangle className="h-8 w-8 text-destructive" />}
            title="Something went wrong"
            body={view.message}
            action={<Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>}
          />
        )}

        {view.kind === "approved" && (
          <Message
            icon={<CheckCircle2 className="h-8 w-8 text-success" />}
            title="Connected. You can close this page."
            body={`${view.hubName} finishes the rest by itself. You can end the connection any time under Settings, Integrations.`}
          />
        )}

        {view.kind === "denied" && (
          <Message
            icon={<XCircle className="h-8 w-8 text-muted-foreground" />}
            title={view.tooManyTries ? "Too many wrong codes" : "Not connected"}
            body={
              view.tooManyTries
                ? "This request was closed and nothing was connected. Start again from your hub."
                : "You said no, so nothing was connected. You can close this page."
            }
          />
        )}

        {view.kind === "confirm" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {view.request.reconnect ? "Connect this hub again?" : "Connect this hub?"}
              </CardTitle>
              <CardDescription>
                {view.request.reconnect
                  ? "This hub has been connected to your account before. Connecting again gives it fresh access, and any earlier access stops working."
                  : `A hub is asking for access to your ${BRAND.name} account.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="space-y-2 text-sm">
                <Row label="Account" value={view.request.account_label} />
                <Row label="Hub" value={view.request.hub_name} />
                <Row label="Computer" value={view.request.device_name} />
              </dl>

              {!askForCode ? (
                <div className="rounded-lg border bg-muted/40 p-4 text-center">
                  <p className="text-xs text-muted-foreground">Check that your hub shows the same code</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tracking-widest" data-testid="user-code">
                    {view.request.user_code}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="hub-code">Type the code your hub shows</Label>
                  <Input
                    id="hub-code"
                    value={typedCode}
                    onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
                    placeholder="ABCD-EFGH"
                    autoComplete="off"
                    className="text-center font-mono text-xl tracking-widest"
                  />
                </div>
              )}
              {codeProblem && <p className="text-sm text-destructive" role="alert">{codeProblem}</p>}

              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>
                    Your hub's assistants can read your profile, people, notes and facts in {BRAND.name}, and save notes for you.
                  </span>
                </li>
                <li className="flex gap-2 text-muted-foreground">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>No files from your hub are copied.</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                disabled={answering !== null || (askForCode && !typedCode.trim())}
                onClick={() => answer(false)}
              >
                {answering === "no" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Don't connect
              </Button>
              <Button
                className="flex-1"
                disabled={answering !== null || (askForCode && !typedCode.trim())}
                onClick={() => answer(true)}
              >
                {answering === "yes" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium" title={value}>{value}</dd>
    </div>
  );
}

function Message({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}
