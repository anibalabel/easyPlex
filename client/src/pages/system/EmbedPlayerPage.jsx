import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Hls from 'hls.js';
import api from '../../lib/api';

export default function EmbedPlayerPage() {
  const { embedId } = useParams();
  const [embed, setEmbed] = useState(null);
  const [error, setError] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    api
      .get(`/api/embeds/show/${embedId}`)
      .then(({ data }) => setEmbed(data))
      .catch(() => setError('Embed media not found.'));
  }, [embedId]);

  useEffect(() => {
    const url = embed?.link;
    if (!url || /youtube\.com|youtu\.be/i.test(url)) return undefined;
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
  }, [embed]);

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!embed) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <p className="text-sm text-slate-400">Loading player...</p>
      </div>
    );
  }

  const url = embed.link || '';
  const isYt = /youtube\.com|youtu\.be/i.test(url);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      {isYt ? (
        <iframe
          src={url}
          title={embed.title || 'Embed Player'}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen"
        />
      ) : (
        <video ref={videoRef} controls autoPlay className="w-full h-full bg-black" />
      )}
    </div>
  );
}
