import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2, KeyRound } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/password/email', { email });
      setResetToken(data?.reset_token || '');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/60 to-slate-950 p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/85 backdrop-blur-xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-white mb-1">Reset Password</h1>
        <p className="text-xs text-slate-400 mb-6">Enter your email address to generate a password reset token.</p>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
            {error}
          </div>
        )}

        {resetToken ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-200 space-y-2">
              <p className="font-semibold">Reset token generated (local dev mode):</p>
              <p className="font-mono bg-slate-950/60 p-2 rounded-lg break-all select-all">{resetToken}</p>
            </div>
            <Link
              to={`/password/reset/${encodeURIComponent(resetToken)}?email=${encodeURIComponent(email)}`}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-semibold text-white"
            >
              <KeyRound className="h-4 w-4" /> Continue to Set New Password
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="h-4 w-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@easyplex.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 pl-10 pr-3.5 py-2.5 text-sm text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-semibold text-white"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Reset Link
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-xs text-slate-400">
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}
