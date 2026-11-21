import React, { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

export default function ImageInput({
  label,
  value = '',
  onChange,
  uploadEndpoint,
  fieldName = 'image',
  placeholder = 'https://image.tmdb.org/t/p/w500/...',
  aspect = 'poster',
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadEndpoint) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(fieldName, file);
      const { data } = await api.post(uploadEndpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const nextUrl = data?.image_path || data?.thumbnail_url || data?.avatar || data?.path || '';
      if (nextUrl) {
        onChange(nextUrl);
        toast.success('Image uploaded');
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const previewUrl = resolveMediaImage(value);

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>
        {uploadEndpoint && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 shrink-0"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </button>
          </>
        )}
      </div>

      {previewUrl ? (
        <div
          className={`mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 ${
            aspect === 'backdrop' ? 'h-24 w-44' : aspect === 'square' ? 'h-16 w-16' : 'h-28 w-20'
          }`}
        >
          <img
            src={previewUrl}
            alt={label || 'Preview'}
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div
          className={`mt-2 flex items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 ${
            aspect === 'backdrop' ? 'h-16 w-28' : 'h-16 w-14'
          }`}
        >
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
