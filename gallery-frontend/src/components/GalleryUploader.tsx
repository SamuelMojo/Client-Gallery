import { useRef, useState } from 'react';
import { fetchAuthSession } from '../auth';
import {
  ACCEPT_ATTR,
  contentTypeFor,
  formatBytes,
  kindOf,
  validateFiles,
  type MediaKind,
  type RejectedFile,
} from '../mediaTypes';

type FileState = 'queued' | 'uploading' | 'done' | 'failed';

interface UploadProgress {
  state: FileState;
  pct: number;
  error?: string;
}

interface UploadTarget {
  fileName: string;
  uploadUrl: string;
  /** Headers the URL was signed with. They must be sent exactly as given. */
  headers?: Record<string, string>;
}

const CONCURRENCY = 3;
const KIND_LABEL: Record<MediaKind, string> = { image: 'Photo', raw: 'RAW', video: 'Video' };

/** PUT one file straight to S3 with progress. Resolves on 2xx, rejects otherwise. */
function putFile(file: File, target: UploadTarget, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.uploadUrl);
    const headers = target.headers ?? { 'Content-Type': contentTypeFor(file) };
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Rejected by storage (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

interface Props {
  onSignOut: () => void;
  /** Called once a gallery has fully uploaded, so the page can refresh its public list. */
  onCreated: () => void;
}

/** Admin form: create a gallery and upload photos, RAW files and videos straight to S3. */
export default function GalleryUploader({ onSignOut, onCreated }: Props) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');
  const [createdPin, setCreatedPin] = useState('');
  const targetsRef = useRef<Map<string, UploadTarget>>(new Map());

  const failedCount = Object.values(progress).filter((p) => p.state === 'failed').length;
  // Once a gallery record exists with failed files, the file list is frozen until they are retried.
  const locked = busy || failedCount > 0;

  const counts = files.reduce(
    (acc, f) => {
      const kind = kindOf(f.name);
      if (kind) acc[kind] += 1;
      acc.bytes += f.size;
      return acc;
    },
    { image: 0, raw: 0, video: 0, bytes: 0 }
  );

  const patchProgress = (name: string, patch: Partial<UploadProgress>) =>
    setProgress((prev) => {
      const base: UploadProgress = prev[name] ?? { state: 'queued', pct: 0 };
      return { ...prev, [name]: { ...base, ...patch } };
    });

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = validateFiles(Array.from(e.target.files ?? []), files);
    setFiles((prev) => [...prev, ...result.accepted]);
    setRejected(result.rejected);
    e.target.value = ''; // lets the same file be picked again after removing it
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const resetForm = () => {
    setTitle('');
    setClientName('');
    setFiles([]);
    setProgress({});
    setRejected([]);
  };

  /** Uploads the named files, CONCURRENCY at a time. Returns how many failed. */
  const uploadBatch = async (names: string[]): Promise<number> => {
    const byName = new Map(files.map((f) => [f.name, f]));
    const queue = [...names];
    let failed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const name = queue.shift() as string;
        const file = byName.get(name);
        const target = targetsRef.current.get(name);
        if (!file || !target) {
          failed += 1;
          patchProgress(name, { state: 'failed', error: 'No upload URL was returned for this file' });
          continue;
        }
        patchProgress(name, { state: 'uploading', pct: 0, error: undefined });
        try {
          await putFile(file, target, (pct) => patchProgress(name, { pct }));
          patchProgress(name, { state: 'done', pct: 100 });
        } catch (err: unknown) {
          failed += 1;
          patchProgress(name, { state: 'failed', error: err instanceof Error ? err.message : 'Upload failed' });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
    return failed;
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0 || locked) return;

    setBusy(true);
    setCreatedUrl('');
    setCreatedPin('');
    try {
      setStatus('Creating gallery...');
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      // 1. Create the gallery and get one presigned URL per file.
      //    `fileNames` is kept for older Lambda versions; `files` carries type and size for validation.
      const res = await fetch(`${API_BASE}/admin/galleries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          clientName,
          isPublic,
          fileNames: files.map((f) => f.name),
          files: files.map((f) => ({
            fileName: f.name,
            contentType: contentTypeFor(f),
            size: f.size,
            kind: kindOf(f.name),
          })),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Could not create gallery (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }

      const { galleryId, uploadUrls, accessPin } = (await res.json()) as {
        galleryId: string;
        uploadUrls: UploadTarget[];
        accessPin: string;
      };
      targetsRef.current = new Map(uploadUrls.map((u) => [u.fileName, u]));

      // 2. Upload every file directly to S3.
      setProgress(Object.fromEntries(files.map((f) => [f.name, { state: 'queued', pct: 0 } as UploadProgress])));
      setStatus(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`);
      const failed = await uploadBatch(files.map((f) => f.name));

      setCreatedPin(accessPin);
      setCreatedUrl(`${window.location.origin}/g/${galleryId}`);
      if (failed === 0) {
        setStatus('Gallery published successfully!');
        resetForm();
        onCreated();
      } else {
        setStatus(`${failed} of ${files.length} files failed to upload. Retry them before sharing the link.`);
      }
    } catch (err: unknown) {
      setStatus(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    const failedNames = files.filter((f) => progress[f.name]?.state === 'failed').map((f) => f.name);
    if (failedNames.length === 0 || busy) return;
    setBusy(true);
    setStatus(`Retrying ${failedNames.length} file${failedNames.length === 1 ? '' : 's'}...`);
    try {
      const failed = await uploadBatch(failedNames);
      if (failed === 0) {
        setStatus('Gallery published successfully!');
        resetForm();
        onCreated();
      } else {
        setStatus(`${failed} files still failing. Their upload links may have expired.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-neutral-500';
  const labelClass = 'block text-xs text-neutral-400 uppercase tracking-wider mb-1';

  return (
    <form onSubmit={handleUpload} className="space-y-4">
      <div className="flex justify-between items-center pb-3 border-b border-neutral-800 mb-4">
        <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Active Admin Session</span>
        <button type="button" onClick={onSignOut} className="text-xs text-neutral-500 hover:text-white transition uppercase">
          Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Gallery Title</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Architectural Series"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Client Name</label>
          <input
            type="text"
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Studio Red"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 py-1">
        <input
          type="checkbox"
          id="homeIsPublic"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-800 bg-neutral-900 text-white cursor-pointer"
        />
        <label htmlFor="homeIsPublic" className="text-xs text-neutral-300 select-none cursor-pointer">
          Showcase publicly in portfolio grid below
        </label>
      </div>

      <div>
        <label className={labelClass}>Upload Photos &amp; Videos</label>
        <input
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          onChange={handleSelect}
          disabled={locked}
          className="w-full text-xs text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-neutral-800 file:text-white cursor-pointer disabled:opacity-50"
        />
        <p className="mt-1 text-[11px] text-neutral-500">
          JPEG, PNG, WebP, HEIC, AVIF, TIFF, GIF, RAW (ARW, CR2, CR3, NEF, DNG, RAF), MP4, MOV, WebM. Videos up to 5 GB.
        </p>
      </div>

      {rejected.length > 0 && (
        <div className="p-3 bg-rose-950/40 border border-rose-900 rounded text-xs text-rose-300 space-y-1">
          <p className="font-medium">
            {rejected.length} file{rejected.length === 1 ? ' was' : 's were'} not added:
          </p>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`} className="truncate">
                <span className="font-mono">{r.name}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-400">
            {counts.image > 0 && `${counts.image} photo${counts.image === 1 ? '' : 's'}`}
            {counts.raw > 0 && `${counts.image > 0 ? ', ' : ''}${counts.raw} RAW`}
            {counts.video > 0 &&
              `${counts.image + counts.raw > 0 ? ', ' : ''}${counts.video} video${counts.video === 1 ? '' : 's'}`}
            {` · ${formatBytes(counts.bytes)}`}
          </p>
          <ul className="max-h-72 overflow-y-auto divide-y divide-neutral-800 border border-neutral-800 rounded bg-neutral-900/50">
            {files.map((f) => {
              const kind = kindOf(f.name);
              const p = progress[f.name];
              return (
                <li key={f.name} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    {kind && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-neutral-800 text-[10px] uppercase tracking-wider text-neutral-300">
                        {KIND_LABEL[kind]}
                      </span>
                    )}
                    <span className="truncate flex-1 text-neutral-200">{f.name}</span>
                    <span className="shrink-0 text-neutral-500 font-mono">{formatBytes(f.size)}</span>
                    {p?.state === 'done' && <span className="shrink-0 text-emerald-400">✓</span>}
                    {p?.state === 'failed' && <span className="shrink-0 text-rose-400">Failed</span>}
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => removeFile(f.name)}
                        className="shrink-0 text-neutral-500 hover:text-white"
                        aria-label={`Remove ${f.name}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {p && p.state !== 'queued' && (
                    <div className="mt-1.5 h-1 bg-neutral-800 rounded overflow-hidden">
                      <div
                        className={`h-full transition-all ${p.state === 'failed' ? 'bg-rose-500' : p.state === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${p.pct}%` }}
                      />
                    </div>
                  )}
                  {p?.state === 'failed' && p.error && <p className="mt-1 text-rose-400">{p.error}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={locked || files.length === 0}
        className="w-full py-2.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold uppercase tracking-wider rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Uploading...' : 'Create & Upload Gallery'}
      </button>

      {status && <p className="text-xs text-neutral-400 text-center">{status}</p>}

      {failedCount > 0 && !busy && (
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-xs"
          >
            Retry {failedCount} failed file{failedCount === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setStatus('');
              setCreatedUrl('');
              setCreatedPin('');
            }}
            className="px-4 py-2 text-neutral-500 hover:text-white text-xs"
          >
            Start over
          </button>
        </div>
      )}

      {createdUrl && (
        <div className="p-4 bg-black border border-neutral-800 rounded space-y-2 mt-4">
          <div className="flex justify-between items-center">
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Access PIN:</span>
            <span className="font-mono text-lg font-bold tracking-widest text-white">{createdPin}</span>
          </div>
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1">
            <span className="text-xs text-neutral-400 uppercase tracking-wider">URL:</span>
            <a href={createdUrl} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-400 hover:underline break-all">
              {createdUrl}
            </a>
          </div>
        </div>
      )}
    </form>
  );
}
