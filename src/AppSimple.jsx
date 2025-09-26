import React, { useEffect, useState } from 'react';
import './App.css';
import { useSimpleWebRTC } from './hooks/useSimpleWebRTC';
import { requestWakeLock, releaseWakeLock } from './utils/enhancedWakeLock';
import FileSelector from './components/FileSelector';
import RoomManager from './components/RoomManager';
import UserName from './components/UserName';
import SharedFilesByUser from './components/SharedFilesByUser';

function AppSimple() {
  const {
    roomId,
    isHost,
    socketId,
    roomUsers,
    connectedPeers,
    userName,
    sharedFiles,
    transferStatus,
    transferProgress,
    createRoom,
    joinRoom,
    updateUserName,
    sendFile,
    testConnections,
    diagnose
  } = useSimpleWebRTC();

  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Auto-join room from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      joinRoom(roomFromUrl);
    }
  }, []);

  // Keep screen awake
  useEffect(() => {
    requestWakeLock().then(setWakeLockActive);
    return () => releaseWakeLock();
  }, []);

  const getConnectionStatus = () => {
    const expected = roomUsers.length - 1;
    const actual = connectedPeers.length;
    
    if (expected === 0) return { text: 'Waiting for others', color: '#666' };
    if (actual === 0) return { text: 'Disconnected', color: '#f44336' };
    if (actual < expected) return { text: `Partial (${actual}/${expected})`, color: '#ff9800' };
    return { text: 'Connected', color: '#4caf50' };
  };

  const status = getConnectionStatus();

  return (
    <div className="app">
      <header className="app-header">
        <h1>P2P File Share (Simple)</h1>
        <p>Share files directly between devices</p>
      </header>

      <main className="app-main">
        {/* Socket Connection Status */}
        <div style={{
          background: socketId ? '#e8f5e8' : '#ffe8e8',
          border: `1px solid ${socketId ? '#4caf50' : '#f44336'}`,
          borderRadius: '8px',
          padding: '0.5rem',
          margin: '1rem 0',
          textAlign: 'center',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{socketId ? `✅ Connected (ID: ${socketId.substring(0, 8)}...)` : '❌ Connecting to server...'}</span>
          <button 
            onClick={diagnose}
            style={{ 
              padding: '0.25rem 0.5rem', 
              background: '#9C27B0', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Debug
          </button>
        </div>

        <UserName
          userName={userName}
          onUpdateName={updateUserName}
          isConnected={connectedPeers.length > 0}
          connectedUser={connectedPeers.length > 0 ? { name: `${connectedPeers.length} peers` } : null}
        />

        <RoomManager
          roomId={roomId}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          isHost={isHost}
        />

        {/* Connection Status */}
        {roomId && (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
            textAlign: 'center',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: status.color
              }} />
              <span style={{ fontWeight: 'bold' }}>{status.text}</span>
              {roomUsers.length > 0 && <span> • {roomUsers.length} users in room</span>}
            </div>
          </div>
        )}

        {/* Room Users */}
        {roomUsers.length > 0 && (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
            marginBottom: '1rem'
          }}>
            <h4>Room Users:</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {roomUsers.map(user => (
                <span key={user.id} style={{
                  background: user.id === socketId ? '#e3f2fd' : '#f5f5f5',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.9rem'
                }}>
                  {user.name || 'Anonymous'} {user.id === socketId && '(You)'}
                  {connectedPeers.includes(user.id) && ' ✅'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* File Selector */}
        {roomId && (
          <FileSelector
            onFileSelect={sendFile}
            selectedFile={null}
          />
        )}

        {/* Transfer Progress */}
        {transferStatus === 'sending' && (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            <h4>📤 Sending file...</h4>
            <div style={{ color: '#666' }}>Please wait while your file is being sent</div>
          </div>
        )}

        {Object.keys(transferProgress).length > 0 && (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
            marginBottom: '1rem'
          }}>
            <h4>📥 Receiving files...</h4>
            {Object.entries(transferProgress).map(([fileId, progress]) => (
              <div key={fileId} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.9rem' }}>{progress.name}</span>
                  <span style={{ fontSize: '0.9rem' }}>{progress.received}/{progress.total}</span>
                </div>
                <div style={{
                  background: '#f0f0f0',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  height: '8px'
                }}>
                  <div style={{
                    background: '#4caf50',
                    height: '100%',
                    width: `${(progress.received / progress.total) * 100}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Test Buttons */}
        {roomId && (
          <div style={{ textAlign: 'center', margin: '1rem', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button 
              onClick={testConnections}
              style={{ 
                padding: '0.5rem 1rem', 
                background: '#2196F3', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Test Connections ({connectedPeers.length})
            </button>
            
            <button 
              onClick={diagnose}
              style={{ 
                padding: '0.5rem 1rem', 
                background: '#9C27B0', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Diagnose
            </button>
          </div>
        )}

        {/* Emergency Test Button */}
        {!roomId && (
          <div style={{ textAlign: 'center', margin: '1rem' }}>
            <button 
              onClick={() => joinRoom('test123')}
              style={{ 
                padding: '0.5rem 1rem', 
                background: '#FF5722', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Test Join Room 'test123'
            </button>
          </div>
        )}

        {/* Shared Files */}
        <SharedFilesByUser sharedFiles={sharedFiles} />

        {wakeLockActive && (
          <div className="wake-lock-indicator">
            Screen will stay awake
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Files are transferred directly between devices using simplified WebRTC.</p>
      </footer>
    </div>
  );
}

export default AppSimple;