import { useState, useEffect } from 'react';
import type { TrainMeshManager } from '../../lib/trains/trainMeshManager';
import { getTripCache, type CacheStats } from '../../lib/trains/tripCache';

interface TrainDebugPanelProps {
  meshManager: TrainMeshManager | null;
  currentZoom: number;
  lastPollTime?: number;
  pollingIntervalMs?: number;
}

export function TrainDebugPanel({ meshManager, currentZoom, lastPollTime, pollingIntervalMs = 30000 }: TrainDebugPanelProps) {
  const [debugData, setDebugData] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showZoomInfo, setShowZoomInfo] = useState(true);
  const [showCountdown, setShowCountdown] = useState(true);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [countdown, setCountdown] = useState<number>(0);

  // Update countdown every 100ms for smooth display
  useEffect(() => {
    if (!lastPollTime) return;

    const updateCountdown = () => {
      const elapsed = Date.now() - lastPollTime;
      const remaining = Math.max(0, pollingIntervalMs - elapsed);
      setCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 100);
    return () => clearInterval(interval);
  }, [lastPollTime, pollingIntervalMs]);

  // Update cache stats periodically
  useEffect(() => {
    const updateStats = () => {
      try {
        const stats = getTripCache().getStats();
        setCacheStats(stats);
      } catch {
        // Cache not initialized yet
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCaptureDebugInfo = () => {
    if (!meshManager) {
      setDebugData('No mesh manager available');
      return;
    }

    const info = meshManager.getDebugInfo();
    const formatted = JSON.stringify(info, null, 2);
    setDebugData(formatted);
    setIsOpen(true);
  };

  const handleCopy = () => {
    if (debugData) {
      navigator.clipboard.writeText(debugData);
    }
  };

  const getZoomBucket = (zoom: number) => {
    if (zoom < 15) return { range: '0-15', scale: 1.0 };
    return { range: '15+', scale: 0.5 };
  };

  const bucket = getZoomBucket(currentZoom);

  const formatCountdown = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    return `${seconds}s`;
  };

  const countdownProgress = lastPollTime ? (1 - countdown / pollingIntervalMs) * 100 : 0;

  return (
    <>
      {/* Polling countdown - top center of screen */}
      {lastPollTime && showCountdown && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            padding: '12px 20px',
            backgroundColor: countdown < 3000 ? 'rgba(255, 152, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '16px',
            fontWeight: 'bold',
            textAlign: 'center',
            transition: 'background-color 0.3s',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', opacity: 0.8 }}>Next Poll:</span>
            <span>{formatCountdown(countdown)}</span>
          </div>
          <div
            style={{
              width: '80px',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${countdownProgress}%`,
                height: '100%',
                backgroundColor: countdown < 3000 ? '#ff5722' : '#4CAF50',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
          <button
            onClick={() => setShowCountdown(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: '16px',
              lineHeight: 1,
            }}
            title="Hide countdown"
          >
            ×
          </button>
        </div>
      )}

      {/* Show countdown button when hidden */}
      {lastPollTime && !showCountdown && (
        <button
          onClick={() => setShowCountdown(true)}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            padding: '6px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          Show Poll Timer
        </button>
      )}

      {showZoomInfo && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            padding: '15px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '14px',
            minWidth: '200px',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '16px' }}>
            Debug Info
          </div>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Zoom</div>
            <div style={{ marginBottom: '2px' }}>
              <span style={{ color: '#aaa' }}>Level:</span> {currentZoom.toFixed(2)}
            </div>
            <div style={{ marginBottom: '2px' }}>
              <span style={{ color: '#aaa' }}>Bucket:</span> {bucket.range}
            </div>
            <div>
              <span style={{ color: '#aaa' }}>Scale:</span> {bucket.scale}x
            </div>
          </div>
          {cacheStats && (
            <div style={{ borderTop: '1px solid #444', paddingTop: '8px' }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Trip Cache</div>
              <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#aaa' }}>Size:</span> {cacheStats.size}
              </div>
              <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#aaa' }}>Hits:</span> {cacheStats.hits}
              </div>
              <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#aaa' }}>Misses:</span> {cacheStats.misses}
              </div>
              <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#aaa' }}>Hit Rate:</span>{' '}
                <span style={{ color: cacheStats.hitRate > 0.8 ? '#4CAF50' : cacheStats.hitRate > 0.5 ? '#FFC107' : '#f44336' }}>
                  {(cacheStats.hitRate * 100).toFixed(1)}%
                </span>
              </div>
              {cacheStats.pendingRequests > 0 && (
                <div>
                  <span style={{ color: '#aaa' }}>Pending:</span> {cacheStats.pendingRequests}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setShowZoomInfo(false)}
            style={{
              marginTop: '10px',
              padding: '4px 8px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              width: '100%',
            }}
          >
            Hide
          </button>
        </div>
      )}

      {!showZoomInfo && (
        <button
          onClick={() => setShowZoomInfo(true)}
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            padding: '8px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          Show Zoom Info
        </button>
      )}

      <button
        onClick={handleCaptureDebugInfo}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 1000,
          padding: '10px 20px',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '14px',
        }}
      >
        Debug Train Offsets
      </button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 2000,
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            maxWidth: '80vw',
            maxHeight: '80vh',
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h3 style={{ margin: 0 }}>Train Lateral Offset Debug Info</h3>
            <div>
              <button
                onClick={handleCopy}
                style={{
                  marginRight: '10px',
                  padding: '5px 15px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  padding: '5px 15px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
          <pre
            style={{
              backgroundColor: '#f5f5f5',
              padding: '15px',
              borderRadius: '4px',
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          >
            {debugData}
          </pre>
        </div>
      )}

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1999,
          }}
        />
      )}
    </>
  );
}
