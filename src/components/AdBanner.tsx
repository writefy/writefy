import React, { useEffect, useRef } from 'react';

interface AdBannerProps {
  slot: string;
  format?: 'auto' | 'rectangle' | 'banner' | 'leaderboard';
  className?: string;
  label?: string;
  publisherId?: string;
  useRealAds?: boolean;
}

const AdBanner: React.FC<AdBannerProps> = ({
  slot,
  format = 'auto',
  className = '',
  label = 'Advertisement',
  publisherId = '',
  useRealAds = false,
}) => {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (useRealAds && publisherId && publisherId !== 'ca-pub-XXXXXXXXXXXXXXXXX' && slot) {
      try {
        // @ts-ignore
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {}
    }
  }, [useRealAds, publisherId, slot]);

  const minH = format === 'leaderboard' ? 90 : format === 'banner' ? 60 : format === 'rectangle' ? 120 : 60;
  const isReal = useRealAds && publisherId && publisherId !== 'ca-pub-XXXXXXXXXXXXXXXXX' && slot;

  return (
    <div className={`ad-container w-full ${className}`}>
      <div className="text-center text-[10px] text-slate-400 mb-1 font-black uppercase tracking-[0.24em] select-none">{label}</div>
      {isReal ? (
        <ins
          ref={adRef}
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-client={publisherId}
          data-ad-slot={slot}
          data-ad-format={format}
          data-full-width-responsive="true"
        />
      ) : (
        <div
          className="demo-ad-placeholder w-full rounded-[1.25rem] border border-white/70 bg-white/55 shadow-xl shadow-slate-950/5 backdrop-blur-xl ring-1 ring-slate-950/[0.03] flex items-center justify-center gap-3 text-slate-400 select-none"
          style={{ minHeight: minH }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 shadow-[0_0_0_6px_rgba(99,102,241,0.12)]" />
          <div>
            <div className="font-black text-slate-600 text-sm">Ad Network</div>
            <div className="text-xs text-slate-400">Slot: {slot || 'not set'} · {format}</div>
            <div className="text-xs text-slate-400">Configure in Admin Panel → /saaki</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdBanner;
