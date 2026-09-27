import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

interface GalleryImage {
  fileName: string;
  originalKey: string;
  webKey: string;
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
              {gallery.images?.length || 0} Photos
            </span>
            <button
              onClick={handleBatchDownload}
              disabled={isDownloadingAll || !gallery.images?.length}
              className="px-4 py-2 bg-neutral-100 hover:bg-white text-black text-xs font-semibold tracking-wide uppercase rounded transition disabled:opacity-50"
            >
              {isDownloadingAll ? 'Preparing ZIP...' : 'Download All (ZIP)'}
            </button>
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
              <img
                src={`${CDN_BASE}/${img.webKey}`}
                alt={img.fileName}
                loading="lazy"
                className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
              />

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
            <img
              src={`${CDN_BASE}/${activePhoto.webKey}`}
              alt={activePhoto.fileName}
              className="max-h-[80vh] w-auto object-contain select-none"
            />
            <div className="mt-4 flex items-center justify-between w-full px-2">
              <span className="text-xs text-neutral-400">{activePhoto.fileName}</span>
              <button
                type="button"
                onClick={() => handleSingleDownload(activePhoto)}
                className="px-4 py-1.5 bg-white text-black text-xs font-semibold tracking-wider uppercase rounded hover:bg-neutral-200 transition"
              >
                Download Master
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
    </div>
  );
}