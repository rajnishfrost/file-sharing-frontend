import React, { useState } from 'react';

const DebugPanel = ({ socketId, roomId, peers, roomUsers, sharedFiles }) => {
  const [showDebug, setShowDebug] = useState(false);
  
  if (!showDebug) {
    return (
      <button 
        className="debug-toggle"
        onClick={() => setShowDebug(true)}
        style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          background: '#ff9800',
          color: 'white',
          border: 'none',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
          zIndex: 1000
        }}
      >
        Debug
      </button>
    );
  }
  
  return (
    <div 
      className="debug-panel"
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.9)',
        color: 'white',
        padding: '15px',
        borderRadius: '8px',
        fontSize: '12px',
        maxWidth: '300px',
        maxHeight: '400px',
        overflow: 'auto',
        zIndex: 1000,
        fontFamily: 'monospace'
      }}
    >
      <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Debug Info</strong>
        <button 
          onClick={() => setShowDebug(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ×
        </button>
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Socket ID:</strong> {socketId || 'Not connected'}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Room ID:</strong> {roomId || 'No room'}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Connected Peers:</strong> {peers.length}
        {peers.length > 0 && (
          <ul style={{ margin: '4px 0', paddingLeft: '15px' }}>
            {peers.map(peerId => (
              <li key={peerId}>{peerId}</li>
            ))}
          </ul>
        )}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Room Users:</strong> {roomUsers.length}
        {roomUsers.length > 0 && (
          <ul style={{ margin: '4px 0', paddingLeft: '15px' }}>
            {roomUsers.map(user => (
              <li key={user.id}>
                {user.name || 'Anonymous'} ({user.id})
              </li>
            ))}
          </ul>
        )}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Shared Files:</strong> {sharedFiles?.length || 0}
        {sharedFiles && sharedFiles.length > 0 && (
          <ul style={{ margin: '4px 0', paddingLeft: '15px' }}>
            {sharedFiles.map(file => (
              <li key={file.id}>
                {file.name} - {file.sender}
              </li>
            ))}
          </ul>
        )}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <strong>Connection Status:</strong>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>
          ✅ Socket: {socketId ? 'Connected' : 'Disconnected'}<br/>
          📡 Peers: {peers.length}/{roomUsers.length - 1} connected<br/>
          📁 Files: {sharedFiles?.length || 0} total
        </div>
      </div>
      
      <div style={{ marginTop: '10px', fontSize: '10px', opacity: 0.7 }}>
        Check browser console for detailed logs
      </div>
    </div>
  );
};

export default DebugPanel;