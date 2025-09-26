import React, { useEffect, useState } from 'react';
import './App.css';
import { useMultiPeerWebRTC } from './hooks/useMultiPeerWebRTC';
import { requestWakeLock, releaseWakeLock } from './utils/enhancedWakeLock';
import FileSelector from './components/FileSelector';
import ProgressBar from './components/ProgressBar';
import RoomManager from './components/RoomManager';
import UserName from './components/UserName';
import RoomUsers from './components/RoomUsers';
import SharedFilesByUser from './components/SharedFilesByUser';
import DebugPanel from './components/DebugPanel';
import ConnectionStatus from './components/ConnectionStatus';

function AppMulti() {
  const {
    roomId,
    isHost,
    socketId,
    roomUsers,
    peers,
    transferProgress,
    transferStatus,
    userName,
    sharedFiles,
    createRoom,
    joinRoom,
    selectAndSendFile,
    updateUserName,
    testConnections,
    forceReconnect,
    runDiagnostics,
  } = useMultiPeerWebRTC();

  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [fileToSend, setFileToSend] = useState(null);

  // Auto-join room from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      joinRoom(roomFromUrl);
    }
  }, []);

  // Request wake lock when page loads
  useEffect(() => {
    requestWakeLock().then(setWakeLockActive);
    
    // Keep wake lock active
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        requestWakeLock().then(setWakeLockActive);
      }
    }, 30000); // Refresh every 30 seconds
    
    return () => {
      clearInterval(interval);
      releaseWakeLock();
    };
  }, []);

  // Handle file transfer status for wake lock
  useEffect(() => {
    if (transferStatus === 'sending' || transferStatus === 'receiving') {
      requestWakeLock().then(setWakeLockActive);
    }
  }, [transferStatus]);

  const handleFileSelect = (file) => {
    setFileToSend(file);
    if (roomId) {
      // Always try to send the file, the function will handle retries if no peers
      selectAndSendFile(file);
    }
  };

  // Calculate overall progress
  const overallProgress = Object.values(transferProgress).reduce((sum, progress) => sum + progress, 0) / 
    Math.max(Object.keys(transferProgress).length, 1);

  return (
    <div className="app">
      <header className="app-header">
        <h1>P2P File Share</h1>
        <p>Share files directly with up to 20 people</p>
      </header>

      <main className="app-main">
        <UserName
          userName={userName}
          onUpdateName={updateUserName}
          isConnected={peers.length > 0}
          connectedUser={peers.length > 0 ? { name: `${peers.length} users connected` } : null}
        />

        <RoomManager
          roomId={roomId}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          isHost={isHost}
        />

        {roomId && roomUsers.length > 0 && (
          <RoomUsers 
            users={roomUsers}
            currentUserId={socketId}
            currentUserName={userName}
            isHost={isHost}
          />
        )}

        {roomId && (
          <FileSelector
            onFileSelect={handleFileSelect}
            selectedFile={fileToSend}
          />
        )}

        {roomId && (
          <div style={{ textAlign: 'center', margin: '1rem', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {peers.length > 0 && (
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
                Test Connections ({peers.length} peers)
              </button>
            )}
            
            {roomUsers.length > 1 && (
              <>
                <button 
                  onClick={forceReconnect}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    background: '#FF9800', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Force Reconnect ({peers.length}/{roomUsers.length - 1})
                </button>
                
                <button 
                  onClick={runDiagnostics}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    background: '#9C27B0', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Run Diagnostics
                </button>
              </>
            )}
          </div>
        )}

        {(transferStatus === 'sending' || transferStatus === 'receiving') && (
          <ProgressBar
            progress={overallProgress}
            status={transferStatus}
          />
        )}

        <SharedFilesByUser
          sharedFiles={sharedFiles}
        />

        {wakeLockActive && (
          <div className="wake-lock-indicator">
            Screen will stay awake
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Files are transferred directly between devices. No data is stored on servers.</p>
      </footer>
      
      <DebugPanel 
        socketId={socketId}
        roomId={roomId}
        peers={peers}
        roomUsers={roomUsers}
        sharedFiles={sharedFiles}
      />
      
      <ConnectionStatus 
        socketId={socketId}
        roomUsers={roomUsers}
        peers={peers}
        isConnecting={transferStatus === 'waiting'}
      />
    </div>
  );
}

export default AppMulti;