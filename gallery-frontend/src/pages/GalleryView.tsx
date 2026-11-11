import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchAuthSession, getCurrentUser } from '../auth';
import { Play } from 'lucide-react';
import { extOf, kindOf } from '../mediaTypes';

// One item in a gallery. Items saved before video support have no `type`, and are photos.
interface GalleryImage {
  fileName: string;
  originalKey: string;
  webKey?: string; // web-sized webp for photos, transcoded mp4 for videos
  posterKey?: string; // still frame for videos
  type?: 'image' | 'video';
  status?: 'processing' | 'ready' | 'failed';
  size?: number;
}

// Above this size, downloads use a direct link instead of loading the file into memory.
const BLOB_DOWNLOAD_LIMIT = 400 * 1e6;

const isVideo = (m: GalleryImage) => m.type === 'video' || kindOf(m.fileName) === 'video';
const isRaw = (m: GalleryImage) => kindOf(m.fileName) === 'raw';
/** The still image shown in the grid: poster frame for videos, web version for photos. */
const stillKey = (m: GalleryImage) => (isVideo(m) ? m.posterKey : m.webKey);
const placeholderLabel = (m: GalleryImage) =>
  m.status === 'processing' ? 'Processing…' : isVideo(m) ? 'Video' : isRaw(m) ? extOf(m.fileName) : 'No preview';

function Thumb({ src, alt, label }: { src?: string; alt: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[11px] uppercase tracking-widest text-neutral-600">
        {label}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
    />
  );
}

interface GalleryData {
  galleryId: string;
  title: string;
  clientName: string;
  createdAt: string;
  isPublic?: boolean;
  accessPin?: string;
  pin?: string;
  images: GalleryImage[];
}

export default function GalleryView() {
  const { id: galleryId } = useParams<{ id: string }>();
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePhoto, setActivePhoto] = useState<GalleryImage | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  // PIN validation state
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [copied, setCopied] = useState(false);

  // Admin-only: delete this gallery
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const CDN_BASE = import.meta.env.VITE_CDN_URL;
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const ZIPPER_URL = import.meta.env.VITE_ZIPPER_URL;

  const currentUrl = window.location.href;
  const pinDisplay = gallery?.accessPin || gallery?.pin;

  useEffect(() => {
    async function fetchGallery() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/galleries/${galleryId}`);
        if (!res.ok) throw new Error('Gallery not found');
        const data = await res.json();
        
        // Normalize DynamoDB item structure
        const item: GalleryData = data.gallery || data;
        setGallery(item);

        // Check if gallery is public OR if client already unlocked it in this session
        const alreadyUnlocked = sessionStorage.getItem(`unlocked_${galleryId}`) === 'true';
        if (item.isPublic || alreadyUnlocked) {
          setIsUnlocked(true);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    }

    if (galleryId) {
      fetchGallery();
    }
  }, [galleryId, API_BASE]);

  // Clients are never signed in, so a Cognito session means the photographer.
  useEffect(() => {
    getCurrentUser()
      .then(() => setIsAdmin(true))
      .catch(() => setIsAdmin(false));
  }, []);

  const handleDelete = async () => {
    if (!galleryId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) throw new Error('Your admin session has expired. Sign in again from the home page.');

      const res = await fetch(`${API_BASE}/admin/galleries/${encodeURIComponent(galleryId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Delete failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePinUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!galleryId) return;

    setPinError('');

    try {
      const res = await fetch(`${API_BASE}/galleries/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          galleryId: galleryId,
          pin: pinInput.trim(),
        }),
      });

      const data = await res.json();

      if (res.ok && (data.valid || data.success || data.unlocked)) {
        sessionStorage.setItem(`unlocked_${galleryId}`, 'true');
        setIsUnlocked(true);
        setPinError('');
      } else {
        setPinError(data.message || data.error || 'Incorrect access PIN. Please try again.');
      }
    } catch {
      setPinError('Failed to verify PIN. Please try again.');
    }
  };

  // Handle single high-res download
  const handleSingleDownload = async (img: GalleryImage) => {
    // Photos and ordinary videos are fetched into the page and saved from there. That works in every
    // browser, including Brave, which can block downloads that start on another site's address.
    // Only very large files skip this, because a blob holds the whole file in memory; those are handed
    // to the browser as a direct link. The originals are stored with "Content-Disposition: attachment",
    // so the link saves the file and the page stays put.
    if ((isVideo(img) || isRaw(img)) && (img.size ?? 0) > BLOB_DOWNLOAD_LIMIT) {
      const link = document.createElement('a');
      link.href = `${CDN_BASE}/${img.originalKey}`;
      link.download = img.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    try {
      const originalUrl = `${CDN_BASE}/${img.originalKey}`;
      const response = await fetch(originalUrl);
      const blob = await response.blob();
      
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = img.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(`${CDN_BASE}/${img.originalKey}`, '_blank');
    }
  };

  // Trigger streaming ZIP archive
  const handleBatchDownload = () => {
    if (!galleryId) return;
    setIsDownloadingAll(true);

    const galleryTitle = gallery?.title || 'Photos';
    const downloadEndpoint = `${ZIPPER_URL}?galleryId=${encodeURIComponent(galleryId)}&title=${encodeURIComponent(galleryTitle)}`;
    window.location.assign(downloadEndpoint);

    setTimeout(() => setIsDownloadingAll(false), 4000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center">
        <p className="text-sm tracking-widest uppercase">Loading Gallery...</p>
      </div>
    );
  }

  if (error || !gallery) {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex flex-col items-center justify-center gap-4">
        <p className="text-sm">{error || 'Gallery unavailable'}</p>
        <Link to="/" className="text-xs text-neutral-500 hover:text-neutral-300 underline uppercase tracking-widest">
          Return to Home
        </Link>
      </div>
    );
  }

  // Gatekeeper: Display PIN challenge if gallery is private and not yet unlocked
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-black text-neutral-100 flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full p-8 border border-neutral-800 bg-neutral-950 rounded-lg text-center space-y-6">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Private Collection
            </span>
            <h1 className="text-2xl font-light tracking-tight mt-1">{gallery.title}</h1>
            <p className="text-xs text-neutral-400 mt-1">{gallery.clientName}</p>
          </div>

          <form onSubmit={handlePinUnlock} className="space-y-4">
            <div>
              <label htmlFor="galleryPin" className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
                Enter 4-Digit Access PIN
              </label>
              <input
                id="galleryPin"
                type="password"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                autoFocus
                className="w-36 text-center text-2xl tracking-[0.4em] py-2 bg-neutral-900 border border-neutral-800 rounded font-mono text-white focus:outline-none focus:border-neutral-500"
              />
            </div>

            {pinError && <p className="text-xs text-rose-500">{pinError}</p>}

            <button
              type="submit"
              disabled={pinInput.length !== 4}
              className="w-full py-2.5 bg-neutral-100 hover:bg-white text-black text-xs font-semibold uppercase tracking-wider rounded transition disabled:opacity-40"
            >
              Unlock Gallery
            </button>
          </form>

          {/* Quick share widget on locked screen */}
          <div className="pt-2 border-t border-neutral-900 flex items-center justify-between gap-2">
            <input
              type="text"
              readOnly
              value={currentUrl}
              className="bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-[11px] font-mono text-neutral-400 w-full truncate focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-semibold uppercase tracking-wider rounded transition whitespace-nowrap"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <Link to="/" className="block text-xs text-neutral-600 hover:text-neutral-400">
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const videoCount = gallery.images?.filter(isVideo).length ?? 0;
  const photoCount = (gallery.images?.length ?? 0) - videoCount;

  return (
    <div className="min-h-screen bg-black text-neutral-100 pb-24">
      {/* Header bar */}
      <header className="sticky top-0 z-30 bg-black/80 backdrop-blur-md border-b border-neutral-900">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <Link to="/" className="text-xs text-neutral-500 hover:text-neutral-300 transition mr-2">
                ← Home
              </Link>
              <h1 className="text-2xl font-light tracking-tight">{gallery.title}</h1>
              {gallery.createdAt && (
                <span className="text-xs text-neutral-500 font-mono tracking-wider">
                  • {new Date(gallery.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">{gallery.clientName}</p>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs tracking-wider text-neutral-500 uppercase">
              {photoCount} Photo{photoCount === 1 ? '' : 's'}
              {videoCount > 0 && ` · ${videoCount} Video${videoCount === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={handleBatchDownload}
              disabled={isDownloadingAll || !gallery.images?.length}
              className="px-4 py-2 bg-neutral-100 hover:bg-white text-black text-xs font-semibold tracking-wide uppercase rounded transition disabled:opacity-50"
            >
              {isDownloadingAll ? 'Preparing ZIP...' : videoCount > 0 ? 'Download Photos (ZIP)' : 'Download All (ZIP)'}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirm('');
                  setDeleteError('');
                  setShowDelete(true);
                }}
                className="px-4 py-2 border border-rose-900 text-rose-400 hover:bg-rose-950/50 text-xs font-semibold tracking-wide uppercase rounded transition"
              >
                Delete Gallery
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Gallery Details / Share / PIN Bar */}
      <section className="max-w-7xl mx-auto px-6 mt-6">
        <div className="bg-neutral-950 border border-neutral-900 rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-neutral-500 uppercase tracking-widest text-[11px] font-medium">
              Access PIN
            </span>
            <span className="font-mono text-base font-semibold tracking-widest text-emerald-400 bg-neutral-900 px-3 py-1 rounded border border-neutral-800">
              {pinDisplay || 'None'}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              readOnly
              value={currentUrl}
              className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 font-mono text-xs text-neutral-400 w-full sm:w-80 truncate focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3.5 py-1.5 bg-neutral-100 hover:bg-white text-black font-semibold uppercase tracking-wider text-[11px] rounded transition whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
      </section>

      {/* Grid: Uses the auto-compressed WebP keys */}
      <main className="max-w-7xl mx-auto px-6 mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {gallery.images?.map((img) => (
            <div
              key={img.originalKey}
              className="group relative aspect-[3/2] bg-neutral-950 overflow-hidden cursor-pointer rounded-sm border border-neutral-900"
              onClick={() => setActivePhoto(img)}
            >
              <Thumb
                src={stillKey(img) ? `${CDN_BASE}/${stillKey(img)}` : undefined}
                alt={img.fileName}
                label={placeholderLabel(img)}
              />

              {isVideo(img) && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-12 h-12 rounded-full bg-black/60 border border-white/30 flex items-center justify-center">
                    <Play className="w-5 h-5 text-white fill-white" />
                  </span>
                </div>
              )}

              {/* Hover overlay with single download button */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3">
                <span className="text-xs text-neutral-300 truncate max-w-[160px]">
                  {img.fileName}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSingleDownload(img);
                  }}
                  className="px-2 py-1 bg-black/70 hover:bg-black text-neutral-200 text-xs rounded border border-neutral-700 transition"
                  title="Download Full Resolution"
                >
                  Download Original
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Fullscreen Lightbox Modal */}
      {activePhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActivePhoto(null)}
        >
          <div
            className="relative max-w-6xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideo(activePhoto) ? (
              activePhoto.webKey && activePhoto.status !== 'processing' && activePhoto.status !== 'failed' ? (
                <video
                  key={activePhoto.originalKey}
                  controls
                  playsInline
                  preload="metadata"
                  poster={activePhoto.posterKey ? `${CDN_BASE}/${activePhoto.posterKey}` : undefined}
                  src={`${CDN_BASE}/${activePhoto.webKey}`}
                  className="max-h-[80vh] max-w-full bg-black"
                />
              ) : (
                <p className="py-24 px-8 text-sm text-neutral-400 text-center">
                  {activePhoto.status === 'failed'
                    ? 'The preview for this video could not be created. You can still download the original.'
                    : 'This video is still being prepared for playback. You can download the original now.'}
                </p>
              )
            ) : stillKey(activePhoto) ? (
              <img
                src={`${CDN_BASE}/${stillKey(activePhoto)}`}
                alt={activePhoto.fileName}
                className="max-h-[80vh] w-auto object-contain select-none"
              />
            ) : (
              <p className="py-24 px-8 text-sm text-neutral-400 text-center">
                No preview for this file type. Download the original to open it.
              </p>
            )}
            <div className="mt-4 flex items-center justify-between w-full px-2">
              <span className="text-xs text-neutral-400">{activePhoto.fileName}</span>
              <button
                type="button"
                onClick={() => handleSingleDownload(activePhoto)}
                className="px-4 py-1.5 bg-white text-black text-xs font-semibold tracking-wider uppercase rounded hover:bg-neutral-200 transition"
              >
                Download Original
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActivePhoto(null)}
            className="absolute top-6 right-6 text-neutral-500 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>
      )}

      {/* Admin delete confirmation */}
      {showDelete && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => !deleting && setShowDelete(false)}
        >
          <div
            className="max-w-md w-full p-6 border border-rose-900/60 bg-neutral-950 rounded-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-light tracking-tight">Delete this gallery?</h2>
            <p className="text-sm text-neutral-400">
              This permanently deletes <span className="text-neutral-200">{gallery.title}</span>, its{' '}
              {gallery.images?.length || 0} file{(gallery.images?.length || 0) === 1 ? '' : 's'} including the
              full-resolution originals, and its link and PIN. It cannot be undone.
            </p>
            <div>
              <label htmlFor="deleteConfirm" className="block text-xs text-neutral-400 mb-1">
                Type the gallery title to confirm
              </label>
              <input
                id="deleteConfirm"
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={gallery.title}
                autoFocus
                disabled={deleting}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-rose-700"
              />
            </div>
            {deleteError && <p className="text-xs text-rose-500">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                disabled={deleting}
                className="px-4 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || deleteConfirm.trim() !== gallery.title.trim()}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold tracking-wide uppercase rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}