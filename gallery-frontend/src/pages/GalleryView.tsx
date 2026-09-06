import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

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
  images: GalleryImage[];
}

export default function ClientGallery() {
  const { id: galleryId } = useParams<{ id: string }>();
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePhoto, setActivePhoto] = useState<GalleryImage | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const CDN_BASE = import.meta.env.VITE_CDN_URL;
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const ZIPPER_URL = import.meta.env.VITE_ZIPPER_URL;

  useEffect(() => {
    async function fetchGallery() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/galleries/${galleryId}`);
        if (!res.ok) throw new Error('Gallery not found');
        const data = await res.json();
        
        // Normalize DynamoDB item structure
        const item = data.gallery || data;
        setGallery(item);
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
      // Fallback: Open CloudFront direct link in new tab if blob fetch fails
      window.open(`${CDN_BASE}/${img.originalKey}`, '_blank');
    }
  };

  // Trigger streaming ZIP archive
  const handleBatchDownload = () => {
    if (!galleryId) return;
    setIsDownloadingAll(true);

    // Direct browser navigation to Function URL forces the Content-Disposition attachment stream
    const downloadEndpoint = `${ZIPPER_URL}?galleryId=${encodeURIComponent(galleryId)}`;
    window.location.assign(downloadEndpoint);

    // Reset button state after brief delay
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
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center">
        <p className="text-sm">{error || 'Gallery unavailable'}</p>
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

      {/* Grid: Uses the auto-compressed WebP keys */}
      <main className="max-w-7xl mx-auto px-6 mt-8">
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