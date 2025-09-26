import React from 'react';

const ConnectionStatus = ({ socketId, roomUsers, peers, isConnecting }) => {
  const expectedConnections = roomUsers.length - 1; // Exclude self
  const actualConnections = peers.length;
  
  const getStatusColor = () => {
    if (actualConnections === 0 && expectedConnections > 0) return '#f44336'; // Red - disconnected
    if (actualConnections < expectedConnections) return '#ff9800'; // Orange - partial
    if (actualConnections === expectedConnections && expectedConnections > 0) return '#4caf50'; // Green - fully connected
    return '#666'; // Gray - no room
  };
  
  const getStatusText = () => {
    if (!roomUsers.length) return 'Not in room';
    if (expectedConnections === 0) return 'Waiting for others';
    if (actualConnections === 0) return 'Disconnected';
    if (actualConnections < expectedConnections) return `Partial (${actualConnections}/${expectedConnections})`;
    return 'Connected';
  };
  
  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '10px 15px',
      borderRadius: '20px',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      zIndex: 1000
    }}>
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: getStatusColor(),
        animation: isConnecting ? 'pulse 1s infinite' : 'none'
      }} />
      <span>
        {getStatusText()}
        {roomUsers.length > 1 && ` • ${roomUsers.length} users`}
      </span>
      
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default ConnectionStatus;