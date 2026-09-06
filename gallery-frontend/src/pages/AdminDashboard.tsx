import { useState, useEffect } from 'react';
import { fetchAuthSession, signOut } from '../auth';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState('');
  const [createdUrl, setCreatedUrl] = useState('');
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

      // 1. Request presigned URLs from Lambda
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/galleries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title, clientName, fileNames })
      });

      const { galleryId, uploadUrls } = await res.json();

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
            className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-400">Client Name</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-400">Photos</label>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setFiles(e.target.files)}
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-800 file:text-white"
          />
        </div>
        <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">
          Create & Upload
        </button>
      </form>

      {status && <p className="mt-4 text-sm text-gray-300">{status}</p>}
      {createdUrl && (
        <div className="mt-6 p-4 bg-gray-900 border border-green-700/50 rounded">
          <p className="text-sm text-green-400 mb-1">Shareable Gallery URL:</p>
          <a href={createdUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline break-all">
            {createdUrl}
          </a>
        </div>
      )}
    </div>
  );
}