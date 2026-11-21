import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import Modal from './Modal';

export default function PlayerPreviewModal({ open, onClose, title, url }) {
  const videoRef = useRef(null);

  const isYoutube = Boolean(url && (/youtube\.com|youtu\.be/i.test(url)));
  const getYoutubeEmbed = (u) => {
    const match = u.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
    return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : u;
  };

  useEffect(() => {
    if (!open || !url || isYoutube) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    if (url.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = url;
    return undefined;
  }, [open, url, isYoutube]);

  return (
    <Modal open={open} onClose={onClose} title={title || 'Stream Preview'} size="xl">
      {!url ? (
        <p className="text-sm text-slate-500">No playable stream URL provided.</p>
      ) : isYoutube ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            src={getYoutubeEmbed(url)}
            title={title || 'YouTube Preview'}
            className="h-full w-full"
            allow="autoplay; fullscreen"
          />
        </div>
      ) : (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} controls autoPlay className="h-full w-full" />
        </div>
      )}
      {url && (
        <p className="mt-3 text-xs text-slate-500 break-all font-mono">{url}</p>
      )}
    </Modal>
  );
}
