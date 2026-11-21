import React, { useCallback, useEffect, useState } from 'react';
import {
  CreditCard,
  Plus,
  Pencil,
  Trash2,
  Receipt,
  CheckCircle2,
  XCircle,
  Coins,
  Megaphone,
  ExternalLink,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';

const CURRENCY_OPTIONS = [
  ['USD', 'USD ($) — US Dollar'],
  ['EUR', 'EUR (€) — Euro'],
  ['GBP', 'GBP (£) — British Pound'],
  ['MXN', 'MXN ($) — Mexican Peso'],
  ['COP', 'COP ($) — Colombian Peso'],
  ['ARS', 'ARS ($) — Argentine Peso'],
  ['CLP', 'CLP ($) — Chilean Peso'],
  ['PEN', 'PEN (S/) — Peruvian Sol'],
  ['BRL', 'BRL (R$) — Brazilian Real'],
  ['DOP', 'DOP (RD$) — Dominican Peso'],
  ['CAD', 'CAD ($) — Canadian Dollar'],
  ['AUD', 'AUD ($) — Australian Dollar'],
  ['INR', 'INR (₹) — Indian Rupee'],
  ['JPY', 'JPY (¥) — Japanese Yen'],
  ['TRY', 'TRY (₺) — Turkish Lira'],
  ['AED', 'AED — UAE Dirham'],
  ['SAR', 'SAR — Saudi Riyal'],
  ['MAD', 'MAD — Moroccan Dirham'],
  ['NGN', 'NGN (₦) — Nigerian Naira'],
  ['RUB', 'RUB (₽) — Russian Ruble'],
  ['IDR', 'IDR — Indonesian Rupiah'],
  ['PHP', 'PHP (₱) — Philippine Peso'],
  ['MYR', 'MYR — Malaysian Ringgit'],
  ['THB', 'THB (฿) — Thai Baht'],
];

const BILLING_INTERVALS = [
  ['day', 'Daily (Day)'],
  ['week', 'Weekly (Week)'],
  ['month', 'Monthly (Month)'],
  ['year', 'Yearly (Year)'],
];

const emptyPlanForm = () => ({
  name: '',
  description: '',
  price: '9.99',
  currency: 'USD',
  pack_duration: '30',
  interval: 'month',
  interval_count: 1,
  trial_days: 0,
  max_devices: 2,
  max_profiles: 3,
  sort_order: 0,
  stripe_plan_id: '',
  stripe_price_id: '',
  paypal_plan_id: '',
  razorpay_plan_id: '',
  features: '',
  is_active: 1,
  is_featured: 0,
});

function CurrencySelect({ value, onChange, className = '' }) {
  const normalized = String(value || 'USD').toUpperCase();
  const hasKnown = CURRENCY_OPTIONS.some(([code]) => code === normalized);
  return (
    <select
      data-no-i18n="true"
      value={normalized}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm ${className}`}
    >
      {!hasKnown && normalized && <option value={normalized}>{normalized}</option>}
      {CURRENCY_OPTIONS.map(([code, lbl]) => (
        <option key={code} value={code}>
          {lbl}
        </option>
      ))}
    </select>
  );
}

// 1. PLANS, SUBSCRIPTIONS & COUPONS
export function PlansSubscriptionsPage() {
  const [tab, setTab] = useState('plans');
  const [plans, setPlans] = useState([]);
  const [subs, setSubs] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyPlanForm());
  const [couponForm, setCouponForm] = useState({ code: '', usages_left: 50, details: 'Promo discount', expired_at: '' });
  const [couponModal, setCouponModal] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [pRes, sRes, cRes] = await Promise.all([
        api.get('/admin/plans/data'),
        api.get('/admin/subscriptions/data'),
        api.get('/admin/coupons/data'),
      ]);
      setPlans(Array.isArray(pRes.data) ? pRes.data : pRes.data?.data || []);
      setSubs(sRes.data?.data || sRes.data || []);
      setCoupons(cRes.data?.data || cRes.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const savePlan = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        currency: String(form.currency || 'USD').toUpperCase(),
        currency_plan_app: String(form.currency || 'USD').toUpperCase(),
      };
      if (form.id) await api.put(`/admin/plans/update/${form.id}`, { plan: payload });
      else await api.post('/admin/plans/store', { plan: payload });
      toast.success('Plan saved');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const saveCoupon = async (e) => {
    e.preventDefault();
    try {
      if (couponForm.id) await api.put(`/admin/coupons/${couponForm.id}`, couponForm);
      else await api.post('/admin/coupon/store', couponForm);
      toast.success('Coupon saved');
      setCouponModal(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-indigo-500" /> Plans, Subscriptions &amp; Coupons
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage VIP membership packages, active subscribers &amp; promo codes.</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setCouponForm({ code: '', usages_left: 50, details: '', expired_at: '' });
              setCouponModal(true);
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold"
          >
            + Add Coupon
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyPlanForm());
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add Plan
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 w-fit text-xs">
        {[
          ['plans', `Plans (${plans.length})`],
          ['subs', `Subscriptions (${subs.length})`],
          ['coupons', `Coupons (${coupons.length})`],
        ].map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-lg px-3.5 py-1.5 font-semibold ${tab === k ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <div className="flex items-center gap-1">
                    {!Number(p.is_active ?? 1) && (
                      <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold text-slate-400">INACTIVE</span>
                    )}
                    {Boolean(p.is_featured) && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">FEATURED</span>
                    )}
                  </div>
                </div>
                <p className="text-2xl font-extrabold text-indigo-500 mt-1">
                  {p.price} <span className="text-xs uppercase font-semibold">{p.currency}</span>
                  <span className="text-xs text-slate-500 font-normal"> / {p.pack_duration} days ({p.interval || 'month'})</span>
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {p.max_devices} device(s) • {p.max_profiles} profile(s){Number(p.trial_days || 0) > 0 ? ` • ${p.trial_days}d trial` : ''}
                </p>
                {p.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</p>}
              </div>
              <div className="flex justify-end gap-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setForm({
                      ...emptyPlanForm(),
                      ...p,
                      currency: String(p.currency || p.currency_plan_app || 'USD').toUpperCase(),
                      features: Array.isArray(p.features) ? p.features.join('\n') : p.features || '',
                    });
                    setModalOpen(true);
                  }}
                  className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete plan ${p.name}?`)) return;
                    await api.delete(`/admin/plans/destroy/${p.id}`);
                    load();
                  }}
                  className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'subs' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">User / Plan</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Period End</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {subs.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No active subscriptions recorded.</td></tr>
              ) : (
                subs.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-semibold">{s.user_name || `User #${s.user_id}`} — {s.name}</td>
                    <td className="px-4 py-3 text-xs uppercase">{s.provider}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-emerald-500">{s.stripe_status || s.provider_status}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{s.ends_at || s.current_period_end || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'coupons' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Usages Left</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {coupons.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No coupons yet.</td></tr>
              ) : (
                coupons.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-bold text-indigo-500">{c.code}</td>
                    <td className="px-4 py-3 text-xs">{c.usages_left}</td>
                    <td className="px-4 py-3 text-xs">{c.expired_at || 'Never'}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button type="button" onClick={() => { setCouponForm({ ...c }); setCouponModal(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={async () => { await api.delete(`/admin/coupon/destroy/${c.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Plan' : 'New Plan'} size="lg">
        <form onSubmit={savePlan} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Plan Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Pro Ultra 4K"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Price *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="9.99"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Currency *</label>
              <CurrencySelect
                value={form.currency || 'USD'}
                onChange={(currency) => setForm({ ...form, currency, currency_plan_app: currency })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Duration (Days) *</label>
              <input
                type="number"
                min="1"
                required
                placeholder="30"
                value={form.pack_duration}
                onChange={(e) => setForm({ ...form, pack_duration: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">Days active per renewal</p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Billing Interval</label>
              <select
                value={form.interval || 'month'}
                onChange={(e) => setForm({ ...form, interval: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {BILLING_INTERVALS.map(([val, lbl]) => (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Trial Days</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.trial_days ?? 0}
                onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Max Simultaneous Devices</label>
              <input
                type="number"
                min="1"
                placeholder="2"
                value={form.max_devices}
                onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Max User Profiles</label>
              <input
                type="number"
                min="1"
                placeholder="3"
                value={form.max_profiles}
                onChange={(e) => setForm({ ...form, max_profiles: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Display Order</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.sort_order ?? 0}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Short Description (optional)</label>
            <input
              type="text"
              placeholder="e.g. 4K Ultra HD streaming with downloads on up to 4 devices"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Stripe Price ID (optional)</label>
              <input
                type="text"
                placeholder="price_..."
                value={form.stripe_price_id || ''}
                onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Stripe Plan ID (optional)</label>
              <input
                type="text"
                placeholder="plan_..."
                value={form.stripe_plan_id || ''}
                onChange={(e) => setForm({ ...form, stripe_plan_id: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">PayPal Plan ID (optional)</label>
              <input
                type="text"
                placeholder="P-..."
                value={form.paypal_plan_id || ''}
                onChange={(e) => setForm({ ...form, paypal_plan_id: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Razorpay Plan ID (optional)</label>
              <input
                type="text"
                placeholder="plan_..."
                value={form.razorpay_plan_id || ''}
                onChange={(e) => setForm({ ...form, razorpay_plan_id: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Features (one per line)</label>
            <textarea
              rows={3}
              placeholder={"4K Ultra HD\nAd-free streaming\nOffline downloads"}
              value={form.features || ''}
              onChange={(e) => setForm({ ...form, features: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-5 text-xs pt-1">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={Boolean(Number(form.is_active))} onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })} /> Active (visible in app)
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={Boolean(Number(form.is_featured))} onChange={(e) => setForm({ ...form, is_featured: e.target.checked ? 1 : 0 })} /> Featured (highlighted)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">Save Plan</button>
          </div>
        </form>
      </Modal>

      <Modal open={couponModal} onClose={() => setCouponModal(false)} title={couponForm.id ? 'Edit Coupon' : 'New Coupon'} size="sm">
        <form onSubmit={saveCoupon} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Promo Code *</label>
            <input type="text" required placeholder="PROMO50" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Max Usages *</label>
            <input type="number" min="1" required placeholder="50" value={couponForm.usages_left} onChange={(e) => setCouponForm({ ...couponForm, usages_left: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Expiration Date (optional)</label>
            <input type="date" value={couponForm.expired_at || ''} onChange={(e) => setCouponForm({ ...couponForm, expired_at: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCouponModal(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// 2. OFFLINE PAYMENTS REVIEW
export function OfflinePaymentsPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/offline-payments/data', { params: { page, status: statusFilter } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, statusFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-6 w-6 text-emerald-500" /> Offline Bank Payment Requests
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Verify manual transfer receipts and activate user subscriptions.</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 w-fit text-xs">
        {['all', 'pending', 'approved', 'rejected'].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => {
              setPage(1);
              setStatusFilter(st);
            }}
            className={`rounded-lg px-3 py-1.5 font-semibold capitalize ${statusFilter === st ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
          >
            {st}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Reference / User</th>
              <th className="px-4 py-3">Plan &amp; Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No offline payment requests found.</td></tr>
            ) : (
              data.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-mono font-bold text-xs text-indigo-500">{r.reference}</p>
                    <p className="font-semibold">{r.full_name} ({r.phone})</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">
                    {r.plan_name || `Plan #${r.plan_id}`} — {r.amount} {r.currency}
                  </td>
                  <td className="px-4 py-3 text-xs capitalize">
                    <span className={`rounded-full px-2.5 py-0.5 font-semibold ${
                      r.status === 'approved' ? 'bg-emerald-500/15 text-emerald-500' : r.status === 'rejected' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {r.status === 'pending' && (
                      <>
                        <button type="button" onClick={async () => { await api.post(`/admin/offline-payments/${r.id}/approve`); toast.success('Approved'); load(); }} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10" title="Approve">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={async () => { const reason = window.prompt('Rejection reason:') || 'Invalid receipt'; await api.post(`/admin/offline-payments/${r.id}/reject`, { rejection_reason: reason }); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10" title="Reject">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>
    </div>
  );
}

// 3. CREDITS & PPV SYSTEM
export function CreditsPage() {
  const [tab, setTab] = useState('packages');
  const [summary, setSummary] = useState({});
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [pkgModal, setPkgModal] = useState(false);
  const [pkgForm, setPkgForm] = useState({ name: '', credits_amount: 100, price: 9.99, currency: 'USD', status: 'enabled' });
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [sRes, pRes, uRes, tRes, reqRes] = await Promise.all([
        api.get('/admin/credits/summary'),
        api.get('/admin/credits/packages'),
        api.get('/admin/credits/users'),
        api.get('/admin/credits/transactions'),
        api.get('/admin/credits/purchase-requests'),
      ]);
      setSummary(sRes.data || {});
      setPackages(pRes.data?.packages || []);
      setUsers(uRes.data?.users?.data || []);
      setTransactions(tRes.data?.transactions?.data || tRes.data?.data || []);
      setRequests(reqRes.data?.requests?.data || reqRes.data?.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const savePackage = async (e) => {
    e.preventDefault();
    try {
      if (pkgForm.id) await api.put(`/admin/credits/packages/${pkgForm.id}`, pkgForm);
      else await api.post('/admin/credits/packages', pkgForm);
      toast.success('Credit package saved');
      setPkgModal(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const adjustBalance = async (userId, action) => {
    const amount = Number(window.prompt(`Enter credit amount to ${action}:`, '50'));
    if (!amount || amount < 1) return;
    try {
      await api.post(`/admin/credits/users/${userId}/adjust`, { action, credits_amount: amount, description: `Admin ${action}` });
      toast.success('Wallet updated');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="h-6 w-6 text-amber-500" /> Credits &amp; PPV Unlocks
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure top-up credit bundles, adjust user wallets, and audit transactions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setPkgForm({ name: '', credits_amount: 100, price: 9.99, currency: 'USD', status: 'enabled' });
            setPkgModal(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Credit Package
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Total Circulation', summary.total_balance ?? 0],
          ['Credits Purchased', summary.total_purchased ?? 0],
          ['Credits Spent', summary.total_spent ?? 0],
          ['Pending Requests', summary.pending_purchase_requests ?? 0],
        ].map(([lbl, val]) => (
          <div key={lbl} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500">{lbl}</p>
            <p className="text-xl font-bold mt-1">{Number(val).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 w-fit text-xs">
        {[
          ['packages', `Packages (${packages.length})`],
          ['users', `User Wallets (${users.length})`],
          ['transactions', 'Transactions'],
          ['requests', `Offline Requests (${requests.length})`],
        ].map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 font-semibold ${tab === k ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'packages' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {packages.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex justify-between">
                <h3 className="font-bold">{p.name}</h3>
                <span className={`text-[10px] font-bold uppercase rounded px-2 py-0.5 ${p.status === 'enabled' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                  {p.status}
                </span>
              </div>
              <p className="text-2xl font-extrabold text-amber-500">{p.credits_amount} Credits</p>
              <p className="text-sm font-semibold">{p.price} {p.currency}</p>
              <div className="flex justify-end gap-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => { setPkgForm({ ...p }); setPkgModal(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={async () => { await api.delete(`/admin/credits/packages/${p.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Purchased / Spent</th>
                <th className="px-4 py-3 text-right">Adjust Wallet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-semibold">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                  <td className="px-4 py-3 font-bold text-amber-500">{u.balance}</td>
                  <td className="px-4 py-3 text-xs">{u.total_purchased} / {u.total_spent}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button type="button" onClick={() => adjustBalance(u.id, 'add')} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">+ Add</button>
                    <button type="button" onClick={() => adjustBalance(u.id, 'remove')} className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">- Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'transactions' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {transactions.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">No credit transactions yet.</td></tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-xs font-semibold">{t.user_name || `User #${t.user_id}`}</td>
                    <td className="px-4 py-3 text-xs uppercase">{t.type}</td>
                    <td className="px-4 py-3 font-bold text-xs">{t.credits_amount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{t.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'requests' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {requests.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">No credit purchase requests.</td></tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-mono text-xs">{r.reference} ({r.full_name})</td>
                    <td className="px-4 py-3 text-xs font-bold">{r.credits_amount} credits</td>
                    <td className="px-4 py-3 text-xs capitalize">{r.status}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {r.status === 'pending' && (
                        <>
                          <button type="button" onClick={async () => { await api.post(`/admin/credits/purchase-requests/${r.id}/approve`); load(); }} className="rounded-lg p-1.5 text-emerald-500"><CheckCircle2 className="h-4 w-4" /></button>
                          <button type="button" onClick={async () => { await api.post(`/admin/credits/purchase-requests/${r.id}/reject`, { rejection_reason: 'Rejected' }); load(); }} className="rounded-lg p-1.5 text-rose-500"><XCircle className="h-4 w-4" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={pkgModal} onClose={() => setPkgModal(false)} title={pkgForm.id ? 'Edit Credit Package' : 'New Credit Package'} size="sm">
        <form onSubmit={savePackage} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Package Name *</label>
            <input type="text" required placeholder="e.g. Starter 100 Credits" value={pkgForm.name} onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Credits Amount *</label>
              <input type="number" min="1" required placeholder="100" value={pkgForm.credits_amount} onChange={(e) => setPkgForm({ ...pkgForm, credits_amount: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Price *</label>
              <input type="number" step="0.01" min="0" required placeholder="9.99" value={pkgForm.price} onChange={(e) => setPkgForm({ ...pkgForm, price: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Currency</label>
              <CurrencySelect value={pkgForm.currency || 'USD'} onChange={(currency) => setPkgForm({ ...pkgForm, currency })} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Status</label>
              <select value={pkgForm.status || 'enabled'} onChange={(e) => setPkgForm({ ...pkgForm, status: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPkgModal(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// 4. VAST / VMAP ADS MANAGER
export function AdsManagerPage() {
  const [ads, setAds] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ title: '', link: '', clickThroughUrl: '', duration: '00:00:15', skipoffset: '00:00:05', customVast: 0 });
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/ads/data');
      setAds(data?.data || data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.put(`/admin/ads/update/${form.id}`, { ads: form });
      else await api.post('/admin/ads/store', { ads: form });
      toast.success('VAST ad saved');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-indigo-500" /> VAST &amp; Player Ads Manager
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create VAST 3.0 video ad campaigns with click-through &amp; skip offsets.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm({ title: '', link: '', clickThroughUrl: '', duration: '00:00:15', skipoffset: '00:00:05', customVast: 0 });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add VAST Ad
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Duration / Skip</th>
              <th className="px-4 py-3">VAST XML</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {ads.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No VAST ads configured.</td></tr>
            ) : (
              ads.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-xs font-mono text-slate-500 truncate max-w-xs">{a.link}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">{a.duration || '—'} (skip @ {a.skipoffset || '—'})</td>
                  <td className="px-4 py-3 text-xs">
                    <a href={`/api/vast/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-500 hover:underline font-mono">
                      /api/vast/{a.id} <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...a }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/ads/destroy/${a.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit VAST Ad' : 'Create VAST Ad'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Ad Campaign Title *</label>
            <input type="text" required placeholder="Pre-roll Campaign" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Video / Custom VAST XML URL *</label>
            <input type="url" required placeholder="https://example.com/ad.mp4" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Click-Through Destination URL</label>
            <input type="url" placeholder="https://sponsor.example.com" value={form.clickThroughUrl || ''} onChange={(e) => setForm({ ...form, clickThroughUrl: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Duration (HH:MM:SS)</label>
              <input type="text" placeholder="00:00:15" value={form.duration || ''} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Skip Offset (HH:MM:SS)</label>
              <input type="text" placeholder="00:00:05" value={form.skipoffset || ''} onChange={(e) => setForm({ ...form, skipoffset: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm w-full" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save Ad</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
