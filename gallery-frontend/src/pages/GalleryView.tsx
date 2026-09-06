import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface GalleryData {
  title: string;
  clientName: string;
  images: string[];
}

export default function GalleryView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const cloudfrontUrl = (import.meta.env.VITE_CLOUDFRONT_URL || '').replace(/\/+$/, '');

  useEffect(() => {
    if (!id) {
      setError('No gallery ID provided.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`${apiBase}/galleries/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Gallery not found (status: ${res.status})`);
        }
        return res.json();
      })
      .then((resData) => {
        // Support both direct item return or nested { gallery: { ... } }
        const gallery = resData.gallery || resData;
        setData({
          title: gallery.title || 'Untitled Gallery',
          clientName: gallery.clientName || 'Client',
          images: Array.isArray(gallery.images) ? gallery.images : []
        });
      })
      .catch((err: Error) => {
        console.error('Failed to load gallery:', err);
        setError(err.message || 'Gallery not found.');
      })
      .finally(() => setLoading(false));
  }, [id, apiBase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-400">
        Loading gallery...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400 p-6 text-center">
        <h2 className="text-xl font-medium text-red-400 mb-2">Error Loading Gallery</h2>
        <p className="text-sm text-neutral-500">{error || 'Gallery not found.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <header className="max-w-6xl mx-auto py-8 text-center">
        <h1 className="text-3xl font-light tracking-wide">{data.title}</h1>
        <p className="text-sm text-neutral-500 mt-1">Prepared for {data.clientName}</p>
      </header>

      {data.images.length === 0 ? (
        <p className="text-center text-neutral-500 mt-8">No photos in this gallery yet.</p>
      ) : (
        <main className="max-w-6xl mx-auto columns-1 sm:columns-2 md:columns-3 gap-4 space-y-4">
          {data.images.map((key) => {
            const cleanKey = key.startsWith('/') ? key.slice(1) : key;
            const fullUrl = key.startsWith('http') ? key : `${cloudfrontUrl}/${cleanKey}`;

            return (
              <div
                key={key}
                className="overflow-hidden rounded-lg bg-neutral-900 break-inside-avoid shadow-md hover:shadow-xl transition-shadow"
              >
                <img
                  src={fullUrl}
                  alt="Gallery item"
                  loading="lazy"
                  className="w-full h-auto object-cover hover:scale-105 transition-transform duration-300"
                />
              </div>
            );
          })}
        </main>
      )}
    </div>
  );
}