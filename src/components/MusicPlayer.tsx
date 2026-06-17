'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Music, X, Settings } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import {
  DEFAULT_PLAYLIST,
  loadMusicPreferences,
  saveMusicPreferences,
  getTrackById,
  formatDuration,
  type UserMusicPreferences,
  type MusicTrack,
} from '@/lib/music';

export default function MusicPlayer() {
  const { resolvedColors: T } = useTheme();
  const [prefs, setPrefs] = useState<UserMusicPreferences>(loadMusicPreferences());
  const [currentTrack, setCurrentTrack] = useState<MusicTrack>(DEFAULT_PLAYLIST[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Load preferences on mount
  useEffect(() => {
    const loaded = loadMusicPreferences();
    setPrefs(loaded);
    if (loaded.currentTrackId) {
      const track = getTrackById(loaded.currentTrackId);
      if (track) setCurrentTrack(track);
    }
    // Auto-play if enabled and not mobile
    if (loaded.enabled && loaded.autoPlay && typeof window !== 'undefined' && window.innerWidth > 768) {
      setIsPlaying(true);
    }
  }, []);

  // Handle visibility change (mute when user leaves tab)
  useEffect(() => {
    if (!prefs.muteOnLeave) return;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (audioRef.current) {
          audioRef.current.pause();
        }
      } else if (isPlaying && prefs.enabled) {
        if (audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [prefs.muteOnLeave, isPlaying, prefs.enabled]);

  // Save preferences when they change
  useEffect(() => {
    saveMusicPreferences(prefs);
  }, [prefs]);

  // Handle track progress
  useEffect(() => {
    if (isPlaying && currentTrack.duration) {
      progressInterval.current = setInterval(() => {
        setProgress(p => {
          if (p >= 100) {
            handleNext();
            return 0;
          }
          return p + (100 / currentTrack.duration!);
        });
      }, 1000);
    } else {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    }
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, [isPlaying, currentTrack]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
    setPrefs(p => ({ ...p, enabled: true }));
  }, [isPlaying]);

  const handleNext = useCallback(() => {
    const currentIndex = DEFAULT_PLAYLIST.findIndex(t => t.id === currentTrack.id);
    const nextTrack = DEFAULT_PLAYLIST[(currentIndex + 1) % DEFAULT_PLAYLIST.length];
    setCurrentTrack(nextTrack);
    setProgress(0);
    setPrefs(p => ({ ...p, currentTrackId: nextTrack.id }));
  }, [currentTrack]);

  const handlePrev = useCallback(() => {
    const currentIndex = DEFAULT_PLAYLIST.findIndex(t => t.id === currentTrack.id);
    const prevTrack = DEFAULT_PLAYLIST[(currentIndex - 1 + DEFAULT_PLAYLIST.length) % DEFAULT_PLAYLIST.length];
    setCurrentTrack(prevTrack);
    setProgress(0);
    setPrefs(p => ({ ...p, currentTrackId: prevTrack.id }));
  }, [currentTrack]);

  const handleVolumeChange = useCallback((volume: number) => {
    setPrefs(p => ({ ...p, volume }));
  }, []);

  const toggleEnabled = useCallback(() => {
    setPrefs(p => ({ ...p, enabled: !p.enabled }));
    if (!prefs.enabled) {
      setIsPlaying(false);
    }
  }, [prefs.enabled]);

  if (!prefs.enabled) {
    // Show minimal trigger to enable music
    return (
      <button
        onClick={toggleEnabled}
        className="fixed bottom-4 right-4 z-50 p-3 rounded-full transition-all hover:scale-110"
        style={{
          backgroundColor: T.boxBg,
          border: `1px solid ${T.borderColor}`,
          color: T.textMuted,
        }}
        title="Enable background music"
      >
        <VolumeX size={20} />
      </button>
    );
  }

  // Handle volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = prefs.volume / 100;
    }
  }, [prefs.volume]);

  return (
    <>
      {/* Audio element */}
      <audio
        ref={audioRef}
        src={currentTrack.url}
        loop
        autoPlay={isPlaying}
      />

      {/* Music Player Widget */}
      <div
        className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ${
          isMinimized ? 'w-auto' : 'w-80'
        }`}
        style={{
          backgroundColor: T.boxBg,
          border: `1px solid ${T.borderColor}`,
          borderRadius: '12px',
          boxShadow: `0 8px 32px ${T.bgColor}80`,
        }}
      >
        {isMinimized ? (
          // Minimized view
          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-2 p-3 pr-4 transition-all hover:opacity-80"
            style={{ color: T.textColor }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: isPlaying ? T.accentColor + '30' : T.borderColor,
                border: `1px solid ${isPlaying ? T.accentColor : T.borderColor}`,
              }}
            >
              {isPlaying ? (
                <span className="text-lg">🎵</span>
              ) : (
                <Music size={18} style={{ color: T.textMuted }} />
              )}
            </div>
            <div className="text-left">
              <div className="text-xs font-bold" style={{ color: T.textColor }}>
                {isPlaying ? 'Playing' : 'Paused'}
              </div>
              <div className="text-[10px] opacity-60" style={{ color: T.textMuted }}>
                {currentTrack.title}
              </div>
            </div>
            {isPlaying && (
              <div className="ml-1 flex gap-0.5">
                <span className="w-1 h-3 bg-current animate-pulse" style={{ color: T.accentColor }} />
                <span className="w-1 h-3 bg-current animate-pulse" style={{ color: T.accentColor, animationDelay: '0.1s' }} />
                <span className="w-1 h-3 bg-current animate-pulse" style={{ color: T.accentColor, animationDelay: '0.2s' }} />
              </div>
            )}
          </button>
        ) : (
          // Expanded view
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Music size={16} style={{ color: T.accentColor }} />
                <span className="text-xs font-bold" style={{ color: T.textColor }}>
                  LiTTree Radio
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-1.5 rounded transition-all hover:opacity-80"
                  style={{ color: T.textMuted }}
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => setIsMinimized(true)}
                  className="p-1.5 rounded transition-all hover:opacity-80"
                  style={{ color: T.textMuted }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Track Info */}
            <div className="mb-4">
              <div className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>
                {currentTrack.title}
              </div>
              <div className="text-xs opacity-60" style={{ color: T.textMuted }}>
                {currentTrack.artist}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div
                className="h-1 rounded-full overflow-hidden"
                style={{ backgroundColor: T.borderColor }}
              >
                <div
                  className="h-full transition-all duration-1000"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: T.accentColor,
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] opacity-40" style={{ color: T.textMuted }}>
                  {formatDuration(Math.floor((progress / 100) * (currentTrack.duration || 0)))}
                </span>
                <span className="text-[10px] opacity-40" style={{ color: T.textMuted }}>
                  {currentTrack.duration ? formatDuration(currentTrack.duration) : '--:--'}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-3 mb-4">
              <button
                onClick={handlePrev}
                className="p-2 rounded-full transition-all hover:opacity-80"
                style={{ color: T.textColor }}
              >
                <SkipBack size={18} />
              </button>
              <button
                onClick={handlePlayPause}
                className="p-3 rounded-full transition-all hover:scale-105"
                style={{
                  backgroundColor: T.accentColor,
                  color: T.bgColor,
                }}
              >
                {isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>
              <button
                onClick={handleNext}
                className="p-2 rounded-full transition-all hover:opacity-80"
                style={{ color: T.textColor }}
              >
                <SkipForward size={18} />
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleVolumeChange(prefs.volume === 0 ? 50 : 0)}
                style={{ color: T.textMuted }}
              >
                {prefs.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={prefs.volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                style={{
                  backgroundColor: T.borderColor,
                  accentColor: T.accentColor,
                }}
              />
              <span className="text-[10px] w-8 text-right" style={{ color: T.textMuted }}>
                {prefs.volume}%
              </span>
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: T.borderColor }}>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.autoPlay}
                      onChange={(e) => setPrefs(p => ({ ...p, autoPlay: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-xs" style={{ color: T.textMuted }}>
                      Auto-play on load
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.muteOnLeave}
                      onChange={(e) => setPrefs(p => ({ ...p, muteOnLeave: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-xs" style={{ color: T.textMuted }}>
                      Mute when I leave tab
                    </span>
                  </label>
                  <button
                    onClick={toggleEnabled}
                    className="w-full py-2 text-xs font-bold border rounded transition-all hover:opacity-80"
                    style={{ borderColor: T.borderColor, color: T.textMuted }}
                  >
                    Disable Music Player
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
