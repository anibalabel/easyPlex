import React, { useEffect, useState } from 'react';
import { Save, KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import ImageInput from '../../components/shared/ImageInput';

export default function AccountPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState({ name: '', email: '', phone: '', avatar: '' });
  const [passwords, setPasswords] = useState({
    current_password: '',
    new_password: '',
    new_password_confirmation: '',
  });
  const [appPassword, setAppPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    api.get('/admin/account/data').then(({ data }) => {
      const u = data?.user || data;
      if (u) {
        setProfile({
          name: u.name || '',
          email: u.email || '',
          phone: u.phone || '',
          avatar: u.avatar || '',
        });
      }
    }).catch(() => {});
  }, []);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.put('/admin/account/update', profile);
      await refreshUser();
      toast.success('Account profile updated');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await api.put('/admin/account/password/update', passwords);
      setPasswords({ current_password: '', new_password: '', new_password_confirmation: '' });
      toast.success('Password updated successfully');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveAppPassword = async (e) => {
    e.preventDefault();
    try {
      await api.put('/admin/account/passwordApp/update', { password: appPassword });
      setAppPassword('');
      toast.success('App protection PIN / password updated');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage your admin profile, credentials, and app lock security.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveProfile} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h2 className="text-base font-semibold">Profile Details</h2>
          <div>
            <label className="block text-xs font-semibold mb-1">Full Name</label>
            <input
              type="text"
              required
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Email Address</label>
            <input
              type="email"
              required
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Phone Number</label>
            <input
              type="text"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <ImageInput
            label="Avatar URL / Upload"
            value={profile.avatar}
            onChange={(url) => setProfile({ ...profile, avatar: url })}
            uploadEndpoint="/admin/update/avatar"
            aspect="square"
          />
          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Profile
          </button>
        </form>

        <div className="space-y-6">
          <form onSubmit={handleSavePassword} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-indigo-500" /> Change Login Password
            </h2>
            <input
              type="password"
              required
              placeholder="Current Password"
              value={passwords.current_password}
              onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              placeholder="New Password"
              value={passwords.new_password}
              onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              placeholder="Confirm New Password"
              value={passwords.new_password_confirmation}
              onChange={(e) => setPasswords({ ...passwords, new_password_confirmation: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={savingPassword}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:opacity-90 px-4 py-2 text-sm font-semibold text-white"
            >
              Update Password
            </button>
          </form>

          {user?.role === 'admin' && (
            <form onSubmit={handleSaveAppPassword} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" /> Mobile App Access Password
              </h2>
              <p className="text-xs text-slate-500">
                Updates the SHA-256 app access password used when Force Password Access is enabled in Security settings.
              </p>
              <input
                type="password"
                required
                placeholder="Enter app lock password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-semibold text-white"
              >
                Update App Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
