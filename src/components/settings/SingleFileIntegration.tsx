import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Globe, Copy, Check, ExternalLink, Info } from "lucide-react";
import { showToast } from "@/lib/toast";
import { Link } from "react-router-dom";

const SUPABASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co";
const ENDPOINT_URL = `${SUPABASE_URL}/functions/v1/singlefile-capture`;

interface CopyableProps {
  label: string;
  value: string;
  multiline?: boolean;
}

function Copyable({ label, value, multiline }: CopyableProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-stretch gap-2">
        {multiline ? (
          <pre className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all">
            {value}
          </pre>
        ) : (
          <Input readOnly value={value} className="font-mono text-xs" />
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          className="shrink-0"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function SingleFileIntegration() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" /> Web Clipper (SingleFile)
            <Badge variant="secondary" className="text-[10px]">REST upload</Badge>
          </CardTitle>
          <CardDescription>
            Capture entire webpages from Chrome with the{" "}
            <a
              href="https://chromewebstore.google.com/detail/singlefile/mpiodijhokgodhhofbcjdecpffjipkle"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              SingleFile extension <ExternalLink className="h-3 w-3" />
            </a>{" "}
            and save them as searchable Menerio notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground flex gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              SingleFile uploads use a Hub <strong>API key</strong> with the{" "}
              <code className="bg-muted px-1 rounded">notes</code> scope. Generate
              one in the <Link to="/dashboard/settings?tab=apikeys" className="text-primary hover:underline">API Keys</Link> tab,
              then paste it into SingleFile as a Bearer token below.
            </span>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Configure SingleFile</h3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                Click the SingleFile toolbar icon in Chrome → ⚙️ <strong>Options</strong>.
              </li>
              <li>
                Scroll to <strong>Destination</strong> and choose{" "}
                <strong>Upload to a REST Form API</strong>.
              </li>
              <li>Paste the values below.</li>
              <li>
                Save the options and use SingleFile as usual — every captured
                page becomes a new note in <code className="bg-muted px-1 rounded">Web Clips</code>.
              </li>
            </ol>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">SingleFile dialog fields</h3>
            <p className="text-xs text-muted-foreground">
              In the SingleFile options dialog, enable{" "}
              <strong>upload to a REST Form API</strong> and fill in the fields
              exactly as shown below. Leave any field not listed here empty.
            </p>

            <div className="space-y-1.5">
              <Copyable label="URL" value={ENDPOINT_URL} />
              <p className="text-xs text-muted-foreground">
                The Menerio endpoint that receives your captured pages.
              </p>
            </div>

            <div className="space-y-1.5">
              <Copyable
                label="authorization token"
                value="Bearer mnr_YOUR_API_KEY_HERE"
                multiline
              />
              <p className="text-xs text-muted-foreground">
                Paste your API key prefixed with <code className="bg-muted px-1 rounded">Bearer </code>
                (note the trailing space). Replace{" "}
                <code className="bg-muted px-1 rounded">mnr_YOUR_API_KEY_HERE</code> with
                a key generated in the <Link to="/dashboard/settings?tab=apikeys" className="text-primary hover:underline">API Keys tab</Link>{" "}
                — it needs the <code className="bg-muted px-1 rounded">notes</code> scope.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Copyable label="archive data field name" value="file" />
                <p className="text-xs text-muted-foreground">
                  Form field that carries the HTML snapshot. Must be{" "}
                  <code className="bg-muted px-1 rounded">file</code>.
                </p>
              </div>
              <div className="space-y-1.5">
                <Copyable label="archive URL field name" value="url" />
                <p className="text-xs text-muted-foreground">
                  Form field that carries the original page URL. Must be{" "}
                  <code className="bg-muted px-1 rounded">url</code> so Menerio
                  can record the source.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">secret key</Label>
              <p className="text-xs text-muted-foreground">
                Leave empty. Menerio doesn't use SingleFile's shared-secret
                signing — your API key in the authorization token already
                authenticates requests.
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Optional extra form fields</h3>
            <p className="text-xs text-muted-foreground">
              SingleFile can append additional fields to every upload (look for{" "}
              <em>extra HTTP headers / fields</em> in the SingleFile options).
              All are optional:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside ml-2">
              <li><code className="bg-muted px-1 rounded">title</code> — overrides the page title (defaults to the page's <code className="bg-muted px-1 rounded">&lt;title&gt;</code>)</li>
              <li><code className="bg-muted px-1 rounded">tags</code> — comma-separated, e.g. <code className="bg-muted px-1 rounded">research,inspiration</code> (defaults to <code className="bg-muted px-1 rounded">web-clip</code>)</li>
              <li><code className="bg-muted px-1 rounded">folder</code> — folder path for the new note (defaults to <code className="bg-muted px-1 rounded">Web Clips</code>)</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <strong className="text-foreground">What gets saved:</strong> Menerio
            extracts the page title, description and readable text into a Markdown
            note, and stores the original SingleFile HTML snapshot as a wikilinked
            attachment. The source URL is preserved in the note metadata and shown
            with a <em>Web Clipper</em> source badge.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
