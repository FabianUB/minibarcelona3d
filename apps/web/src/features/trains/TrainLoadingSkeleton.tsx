/**
 * TrainLoadingSkeleton Component
 *
 * Displays a skeleton UI while initial train data is loading.
 * Provides visual feedback that the app is working.
 *
 * Task: T099 - Skeleton UI for initial train data loading
 */

export function TrainLoadingSkeleton() {
  return (
    <div
      style={{
        position: 'absolute',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '16px 24px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        zIndex: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '20px',
          height: '20px',
          border: '2px solid #e5e7eb',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <div style={{ color: '#666' }}>
        Loading train data...
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
