import { useState } from 'react';
import { signIn } from '../auth';
import { useNavigate } from 'react-router-dom';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        navigate('/admin');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 text-white px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <h1 className="text-xl font-semibold text-center">Admin Portal</h1>
        {error && <div className="p-2 text-sm text-red-400 bg-red-950/40 rounded border border-red-800">{error}</div>}
        <div>
          <label className="block text-sm mb-1 text-gray-400">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-400">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium transition">
          Sign In
        </button>
      </form>
    </div>
  );
}