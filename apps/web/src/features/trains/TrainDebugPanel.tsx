import { useState } from 'react';
import type { TrainMeshManager } from '../../lib/trains/trainMeshManager';

interface TrainDebugPanelProps {
  meshManager: TrainMeshManager | null;
  currentZoom: number;
}

export function TrainDebugPanel({ meshManager, currentZoom }: TrainDebugPanelProps) {
  const [debugData, setDebugData] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showZoomInfo, setShowZoomInfo] = useState(true);

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

  return (
    <>
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
            Zoom Scale Info
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#aaa' }}>Zoom:</span> {currentZoom.toFixed(2)}
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#aaa' }}>Bucket:</span> {bucket.range}
          </div>
          <div>
            <span style={{ color: '#aaa' }}>Scale:</span> {bucket.scale}x
          </div>
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
