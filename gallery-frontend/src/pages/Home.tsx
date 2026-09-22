import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signIn, signOut, getCurrentUser, fetchAuthSession } from '../auth';

interface PublicGallery {
  galleryId: string;
  title: string;
  clientName: string;
  coverKey?: string;
  coverImage?: string;
  imagesCount?: number;
}

export default function Home() {
  const navigate = useNavigate();

  // Public & Client PIN state
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [publicGalleries, setPublicGalleries] = useState<PublicGallery[]>([]);
  const [loadingGalleries, setLoadingGalleries] = useState(true);

  // Admin Authentication & Upload state
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthError, setAdminAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Admin Upload form state
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');
  const [createdPin, setCreatedPin] = useState('');

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const CDN_BASE = import.meta.env.VITE_CDN_URL;

  // Check admin session on load
  useEffect(() => {
    getCurrentUser()
      .then(() => setIsAdminAuthenticated(true))
      .catch(() => setIsAdminAuthenticated(false));

    fetchPublicGalleries();
  }, []);

  const fetchPublicGalleries = async () => {
    try {
      setLoadingGalleries(true);
      const res = await fetch(`${API_BASE}/galleries/public`);
      if (res.ok) {
        const data = await res.json();
        setPublicGalleries(data.galleries || []);
      }
    } catch {
      // Gracefully handle silent fail for public listing
    } finally {
      setLoadingGalleries(false);
    }
  };

  // 1. PIN Unlock Handler
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim().length !== 4) {
      setPinError('Please enter a valid 4-digit PIN');
      return;
    }

    try {
      setIsVerifyingPin(true);
      setPinError('');

      const res = await fetch(`${API_BASE}/galleries/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });

      if (!res.ok) {
        throw new Error('Invalid PIN or collection not found');
      }

      const { galleryId } = await res.json();
      sessionStorage.setItem(`unlocked_${galleryId}`, 'true');
      navigate(`/g/${galleryId}`);
    } catch (err: any) {
      setPinError(err.message || 'Failed to verify PIN');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // 2. Admin Login Handler
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAdminAuthError('');

    try {
      await signIn({ username: adminUsername, password: adminPassword });
      setIsAdminAuthenticated(true);
      setAdminPassword('');
    } catch (err: any) {
      setAdminAuthError(err.message || 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleAdminLogout = async () => {
    await signOut();
    setIsAdminAuthenticated(false);
    setCreatedUrl('');
    setCreatedPin('');
  };

  // 3. Admin Gallery Creation & Upload Handler
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0) return;

    try {
      setUploadStatus('Obtaining upload signatures...');
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      const fileNames = Array.from(files).map((f) => f.name);

      const res = await fetch(`${API_BASE}/admin/galleries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, clientName, fileNames, isPublic }),
      });

      const data = await res.json();
      const { galleryId, uploadUrls, accessPin } = data;

      setUploadStatus(`Uploading ${files.length} images to S3...`);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const match = uploadUrls.find((u: any) => u.fileName === file.name);
        if (match) {
          await fetch(match.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });
        }
      }

      setUploadStatus('Gallery published successfully!');
      setCreatedPin(accessPin);
      setCreatedUrl(`${window.location.origin}/g/${galleryId}`);
      setTitle('');
      setClientName('');
      setFiles(null);
      fetchPublicGalleries();
    } catch (err: any) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex flex-col justify-between selection:bg-neutral-800">
      {/* Top Navbar */}
      <header className="border-b border-neutral-900 px-6 py-5 flex justify-between items-center bg-black/60 backdrop-blur sticky top-0 z-40">
        <div>
          <span className="font-light tracking-widest text-base uppercase">Samuel Ojo</span>
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">Photography & Portfolio</span>
        </div>

        <button
          onClick={() => setIsAdminOpen(!isAdminOpen)}
          className="text-xs tracking-wider uppercase text-neutral-400 hover:text-white transition px-3 py-1.5 border border-neutral-800 rounded bg-neutral-950"
        >
          {isAdminOpen ? 'Close Portal' : isAdminAuthenticated ? 'Admin Panel' : 'Admin Login'}
        </button>
      </header>

      {/* Admin Expandable Portal Panel */}
      {isAdminOpen && (
        <section className="bg-neutral-950 border-b border-neutral-800 px-6 py-8 animate-fadeIn">
          <div className="max-w-xl mx-auto">
            {!isAdminAuthenticated ? (
              /* Inline Login Form */
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div className="text-center mb-6">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-200">Admin Sign In</h2>
                  <p className="text-xs text-neutral-500 mt-1">Authenticate to create collections and manage storage</p>
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-1">Username / Email</label>
                  <input
                    type="text"
                    required
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-neutral-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-neutral-500"
                  />
                </div>

                {adminAuthError && <p className="text-xs text-rose-500">{adminAuthError}</p>}

                <button
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full py-2.5 bg-white text-black text-xs font-semibold uppercase tracking-wider rounded hover:bg-neutral-200 transition disabled:opacity-50"
                >
                  {isAuthenticating ? 'Signing In...' : 'Enter Dashboard'}
                </button>
              </form>
            ) : (
              /* Inline Gallery Creator Form */
              <form onSubmit={handleUpload} className="space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-neutral-800 mb-4">
                  <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                    ● Admin Active
                  </span>
                  <button
                    type="button"
                    onClick={handleAdminLogout}
                    className="text-xs text-neutral-500 hover:text-white transition uppercase"
                  >
                    Sign Out
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-1">Gallery Title</label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Architectural Series"
                      className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-1">Client Name</label>
                    <input
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="e.g. Studio Red"
                      className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm text-white focus:outline-none focus:border-neutral-500"
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
                  <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-1">Upload Images</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => setFiles(e.target.files)}
                    className="w-full text-xs text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-neutral-800 file:text-white cursor-pointer"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold uppercase tracking-wider rounded transition"
                >
                  Create & Upload Gallery
                </button>

                {uploadStatus && <p className="text-xs text-neutral-400 text-center">{uploadStatus}</p>}

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
            )}
          </div>
        </section>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-12 w-full space-y-16">
        {/* Client Access Bar (4-Digit PIN) */}
        <section className="text-center space-y-4 max-w-md mx-auto">
          <span className="text-[10px] uppercase font-semibold tracking-widest text-neutral-500">
            Client Portal Access
          </span>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight">Private Collection Access</h1>
          <p className="text-xs text-neutral-400">
            Have a private delivery? Enter your 4-digit gallery code below.
          </p>

          <form onSubmit={handlePinSubmit} className="flex justify-center items-center gap-3 pt-2">
            <input
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-32 text-center text-xl tracking-[0.4em] py-2 bg-neutral-950 border border-neutral-800 rounded font-mono text-white focus:outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={isVerifyingPin || pin.length !== 4}
              className="px-5 py-2.5 bg-neutral-100 hover:bg-white text-black text-xs font-semibold uppercase tracking-wider rounded transition disabled:opacity-40"
            >
              {isVerifyingPin ? 'Checking...' : 'Enter'}
            </button>
          </form>
          {pinError && <p className="text-xs text-rose-500">{pinError}</p>}
        </section>

        {/* Public Portfolio Showcase */}
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
            <h2 className="text-xs uppercase font-semibold tracking-widest text-neutral-400">
              Selected Works & Collections
            </h2>
            <span className="text-xs font-mono text-neutral-600">
              {publicGalleries.length} {publicGalleries.length === 1 ? 'Gallery' : 'Galleries'}
            </span>
          </div>

          {loadingGalleries ? (
            <div className="py-20 text-center">
              <p className="text-xs uppercase tracking-widest text-neutral-600">Loading portfolio...</p>
            </div>
          ) : publicGalleries.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-neutral-900 rounded">
              <p className="text-xs text-neutral-500">No public collections published yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {publicGalleries.map((gal) => {
                const imageKey = gal.coverImage || gal.coverKey;

                return (
                  <Link
                    key={gal.galleryId}
                    to={`/g/${gal.galleryId}`}
                    className="group block relative aspect-[4/3] bg-neutral-950 border border-neutral-900 overflow-hidden rounded-sm hover:border-neutral-700 transition"
                  >
                    {imageKey ? (
                      <img
                        src={`${CDN_BASE}/${encodeURI(imageKey)}`}
                        alt={gal.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-700 font-mono text-xs">
                        No Preview
                      </div>
                    )}

                    {/* Caption Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-5 transition opacity-90 group-hover:opacity-100">
                      <h3 className="text-sm font-light text-white tracking-wide">{gal.title}</h3>
                      <p className="text-xs text-neutral-400 mt-0.5">{gal.clientName}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-neutral-900 px-6 py-6 text-center text-[10px] uppercase tracking-widest text-neutral-600">
        © {new Date().getFullYear()} Samuel Ojo. All rights reserved.
      </footer>
    </div>
  );
}