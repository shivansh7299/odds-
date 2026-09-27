"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { useNow } from "@/hooks/use-now";
import { apiFetch } from "@/lib/api/fetcher";
import { formatAgo, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type ImportRow = {
  id: string;
  filename: string;
  sizeBytes: number;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  recordsUpserted: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Upload = {
  key: string;
  name: string;
  progress: number;
  state: "uploading" | "done" | "duplicate" | "error";
  message?: string;
};

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 1024 * 1024 ? 2 : 1)} MB`;

function uploadFile(file: File, onProgress: (p: number) => void): Promise<{ duplicate: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/fit");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { duplicate?: boolean; error?: { message?: string } } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ duplicate: !!body?.duplicate });
      else reject(new Error(body?.error?.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export function FitImport() {
  const queryClient = useQueryClient();
  const { sync } = useRealtime();
  const now = useNow();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const imports = useQuery({
    queryKey: ["imports"],
    queryFn: () => apiFetch<{ imports: ImportRow[] }>("/api/import/fit"),
  });

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        const update = (patch: Partial<Upload>) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
        setUploads((u) => [
          { key, name: file.name, progress: 0, state: "uploading" },
          ...u.filter((x) => x.key !== key),
        ]);
        try {
          const { duplicate } = await uploadFile(file, (progress) => update({ progress }));
          update({ progress: 1, state: duplicate ? "duplicate" : "done" });
        } catch (err) {
          update({ state: "error", message: (err as Error).message });
        }
        queryClient.invalidateQueries({ queryKey: ["imports"] });
      }
    },
    [queryClient],
  );

  const running = sync?.source === "GARMIN_FIT" ? sync : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Upload FIT files</CardTitle>
            <CardDescription>
              Individual <code>.fit</code> files (up to 25 MB) or a <code>.zip</code> such as a Garmin Connect
              export (up to 250 MB). Uploading the same file twice is harmless.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleFiles(e.dataTransfer.files);
              }}
              className={cn(
                "hover:bg-muted/40 focus-visible:ring-ring/50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none",
                dragging && "border-primary bg-muted/60",
              )}
            >
              <FileUp className="text-muted-foreground size-6" aria-hidden />
              <span className="font-medium">Drop files here or click to choose</span>
              <span className="text-muted-foreground">.fit or .zip</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".fit,.FIT,.zip"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {uploads.length > 0 && (
              <ul className="grid gap-2 text-sm" aria-label="Uploads">
                {uploads.map((u) => (
                  <li key={u.key} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      {u.state === "uploading" && (
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                      )}
                      {(u.state === "done" || u.state === "duplicate") && (
                        <CheckCircle2 className="size-4 text-[var(--status-good)]" aria-hidden />
                      )}
                      {u.state === "error" && <XCircle className="text-destructive size-4" aria-hidden />}
                      <span className="truncate">{u.name}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">
                        {u.state === "uploading"
                          ? `${Math.round(u.progress * 100)}%`
                          : u.state === "duplicate"
                            ? "Already imported"
                            : u.state === "done"
                              ? "Uploaded"
                              : u.message}
                      </span>
                    </div>
                    {u.state === "uploading" && (
                      <div className="bg-muted h-1 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full transition-[width]"
                          style={{ width: `${u.progress * 100}%` }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import history</CardTitle>
            {running && (
              <CardDescription className="flex items-center gap-2" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> {running.message}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {imports.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : !imports.data?.imports.length ? (
              <p className="text-muted-foreground text-sm">Nothing imported yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {imports.data.imports.map((j) => (
                  <li key={j.id} className="grid gap-0.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{j.filename}</span>
                      <Badge
                        variant={
                          j.status === "FAILED"
                            ? "destructive"
                            : j.status === "SUCCEEDED"
                              ? "secondary"
                              : "outline"
                        }
                        className="ml-auto shrink-0"
                      >
                        {j.status === "RUNNING" && <Loader2 className="animate-spin" aria-hidden />}
                        {j.status.toLowerCase()}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {mb(j.sizeBytes)} · {formatAgo(j.createdAt, now)}
                      {j.recordsUpserted > 0 && ` · ${formatNumber(j.recordsUpserted)} records`}
                    </div>
                    {j.error && (
                      <p
                        className={cn(
                          "text-xs",
                          j.status === "FAILED" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {j.error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="content-start">
        <CardHeader>
          <CardTitle>Getting files off your watch</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div>
            <h3 className="font-medium">Option A: USB (quick, recent days)</h3>
            <ol className="text-muted-foreground mt-1 list-decimal pl-5">
              <li>Install OpenMTP (macOS can&apos;t read the Forerunner 265&apos;s MTP storage natively).</li>
              <li>Plug the watch into your Mac and open it in OpenMTP.</li>
              <li>
                Copy files from <code>GARMIN/Monitor</code>, <code>GARMIN/Sleep</code>,{" "}
                <code>GARMIN/Activity</code> and <code>GARMIN/Metrics</code>, then drop them here.
              </li>
            </ol>
          </div>
          <div>
            <h3 className="font-medium">Option B: Garmin Connect export (full history)</h3>
            <ol className="text-muted-foreground mt-1 list-decimal pl-5">
              <li>Garmin Connect website → Account → Data Management → Export Your Data.</li>
              <li>Garmin emails a download link (can take up to 48 hours).</li>
              <li>Upload the zip as-is. Nested zips are handled.</li>
            </ol>
          </div>
          <p className="text-muted-foreground text-xs">
            Steps from monitoring files are counted from the second reading of each file, so the first few
            minutes of a file can be slightly undercounted. Nothing is ever double-counted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
