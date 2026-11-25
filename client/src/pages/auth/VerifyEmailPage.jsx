import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailCheck, Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/email/verify', { email });
      setVerified(true);
      toast.success('Email verified successfully');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/60 to-slate-950 p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/85 backdrop-blur-xl p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
          {verified ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <MailCheck className="h-6 w-6" />}
        </div>
        <h1 className="text-xl font-bold text-white mb-2">
          {verified ? 'Email Verified' : 'Verify Your Email'}
        </h1>
        <p className="text-xs text-slate-400 mb-6">
          {verified
            ? 'Your email address has been verified and activated.'
            : 'Confirm your registered email address to verify your EasyPlex account.'}
        </p>

        {!verified && (
          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-semibold text-white"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify Email Address
            </button>
          </form>
        )}

        <Link to="/login" className="mt-5 inline-block text-xs text-indigo-400 hover:text-indigo-300 font-semibold">
          Return to Login
        </Link>
      </div>
    </div>
  );
}
