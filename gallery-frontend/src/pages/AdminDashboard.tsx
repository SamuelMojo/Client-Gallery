import { useState, useEffect } from 'react';
import { fetchAuthSession, signOut } from '../auth';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');
  const [createdPin, setCreatedPin] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchAuthSession().catch(() => navigate('/admin/login'));
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0) return;

    try {
      setStatus('Obtaining upload signatures...');
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      const fileNames = Array.from(files).map((f) => f.name);

      // 1. Request presigned URLs from Lambda including public toggle
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/galleries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title, clientName, fileNames, isPublic })
      });

      const data = await res.json();
      const { galleryId, uploadUrls, accessPin } = data;

      // 2. Upload each file directly to S3
      setStatus(`Uploading ${files.length} images to S3...`);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const match = uploadUrls.find((u: any) => u.fileName === file.name);
        if (match) {
          await fetch(match.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file
          });
        }
      }

      setStatus('Complete!');
      setCreatedPin(accessPin);
      setCreatedUrl(`${window.location.origin}/g/${galleryId}`);
    } catch (err: any) {
      setStatus(`Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 text-gray-100">
      <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold">New Gallery</h1>
        <button onClick={() => { signOut(); navigate('/admin/login'); }} className="text-sm text-gray-400 hover:text-white">
          Sign Out
        </button>
      </div>

      <form onSubmit={handleUpload} className="space-y-4">
        <div>
          <label className="block text-sm mb-1 text-gray-400">Gallery Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-400">Client Name</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded focus:border-neutral-500 focus:outline-none"
          />
        </div>

        {/* Public Collection Checkbox */}
        <div className="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            id="isPublic"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
          <label htmlFor="isPublic" className="text-sm text-gray-300 select-none cursor-pointer">
            Feature publicly on homepage (<span className="text-neutral-500 font-mono">gallery.samuelojo.tech</span>)
          </label>
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-400">Photos</label>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setFiles(e.target.files)}
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-800 file:text-white cursor-pointer"
          />
        </div>
        <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium transition">
          Create & Upload
        </button>
      </form>

      {status && <p className="mt-4 text-sm text-gray-300">{status}</p>}

      {createdUrl && (
        <div className="mt-6 p-5 bg-gray-900 border border-neutral-800 rounded-lg space-y-3">
          <p className="text-sm text-emerald-400 font-medium">✓ Gallery Created Successfully</p>
          
          <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Access PIN:</span>
            <span className="font-mono text-xl font-bold tracking-widest text-white">
              {createdPin || '----'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-t border-neutral-800 pt-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Shareable URL:</span>
            <a href={createdUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline break-all text-sm font-mono">
              {createdUrl}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}