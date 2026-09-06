import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

interface PublicGallery {
  galleryId: string;
  title: string;
  clientName: string;
  createdAt: string;
  coverImage?: string;
}

export default function Home() {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [publicGalleries, setPublicGalleries] = useState<PublicGallery[]>([]);
  const [loadingGalleries, setLoadingGalleries] = useState(true);

  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const CDN_BASE = import.meta.env.VITE_CDN_URL;

  useEffect(() => {
    async function loadPublic() {
      try {
        const res = await fetch(`${API_BASE}/galleries/public`);
        if (res.ok) {
          const data = await res.json();
          setPublicGalleries(data.galleries || []);
        }
      } catch (err) {
        console.error('Failed to load public collections', err);
      } finally {
        setLoadingGalleries(false);
      }
    }
    loadPublic();
  }, [API_BASE]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setPinError('Enter a 4-digit PIN');
      return;
    }

    try {
      setIsVerifying(true);
      setPinError('');

      const res = await fetch(`${API_BASE}/galleries/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      if (!res.ok) throw new Error('Invalid PIN');
      const data = await res.json();

      sessionStorage.setItem(`unlocked_${data.galleryId}`, 'true');
      navigate(`/g/${data.galleryId}`);
    } catch (err: any) {
      setPinError(err.message || 'Gallery not found');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex flex-col items-center px-6 py-20">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-3xl font-extralight tracking-tight">Samuel Ojo Galleries</h1>
        <p className="text-xs text-neutral-400">
          Enter your 4-digit client access PIN to view your private gallery.
        </p>

        <form onSubmit={handlePinSubmit} className="flex flex-col items-center gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-36 text-center text-2xl tracking-[0.4em] py-2 bg-neutral-900 border border-neutral-800 rounded font-mono text-white focus:outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={isVerifying || pin.length !== 4}
              className="px-5 py-2 bg-neutral-100 text-black text-xs font-semibold tracking-wider uppercase rounded hover:bg-white disabled:opacity-40"
            >
              {isVerifying ? 'Checking...' : 'Enter'}
            </button>
          </div>
          {pinError && <p className="text-xs text-rose-500">{pinError}</p>}
        </form>
      </div>

      <div className="max-w-6xl w-full mt-24">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500 border-b border-neutral-900 pb-3 mb-8">
          Featured Collections
        </h2>

        {loadingGalleries ? (
          <p className="text-xs text-neutral-600">Loading collections...</p>
        ) : publicGalleries.length === 0 ? (
          <p className="text-xs text-neutral-600">No public galleries available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {publicGalleries.map((gal) => (
              <Link key={gal.galleryId} to={`/g/${gal.galleryId}`} className="group block space-y-2">
                <div className="aspect-[3/2] bg-neutral-900 rounded overflow-hidden border border-neutral-800">
                  {gal.coverImage ? (
                    <img
                      src={`${CDN_BASE}/${gal.coverImage}`}
                      alt={gal.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-700 text-xs uppercase tracking-wider">
                      View Gallery
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-light text-neutral-200 group-hover:text-white">{gal.title}</h3>
                  <p className="text-xs text-neutral-500">{gal.clientName}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}