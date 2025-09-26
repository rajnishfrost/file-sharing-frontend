import React, { useEffect, useState } from 'react';
import './App.css';
import { useWebRTC } from './hooks/useWebRTC';
import { requestWakeLock, releaseWakeLock } from './utils/wakeLock';
import FileSelector from './components/FileSelector';
import ProgressBar from './components/ProgressBar';
import RoomManager from './components/RoomManager';
import UserName from './components/UserName';
import SharedFiles from './components/SharedFiles';

function App() {
  const {
    roomId,
    isHost,
    isConnected,
    transferProgress,
    transferStatus,
    fileToSend,
    receivedFile,
    userName,
    connectedUser,
    sharedFiles,
    createRoom,
    joinRoom,
    selectFile,
    updateUserName,
    addTestFile,
  } = useWebRTC();

  const [wakeLockActive, setWakeLockActive] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      joinRoom(roomFromUrl);
    }
  }, []);

  useEffect(() => {
    if (transferStatus === 'sending' || transferStatus === 'receiving') {
      requestWakeLock().then(setWakeLockActive);
    } else if (transferStatus === 'complete' || transferStatus === 'error') {
      releaseWakeLock();
      setWakeLockActive(false);
    }
  }, [transferStatus]);

  const handleDownload = () => {
    if (receivedFile) {
      console.log('Downloading file:', receivedFile.name);
      const a = document.createElement('a');
      a.href = receivedFile.url;
      a.download = receivedFile.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log('Download triggered');
    }
  };

  // Auto-download when file is received (optional)
  useEffect(() => {
    if (receivedFile && transferStatus === 'complete') {
      console.log('File received and transfer complete', receivedFile);
      // Uncomment the next line for auto-download:
      // handleDownload();
    }
  }, [receivedFile, transferStatus]);

  // Debug shared files
  useEffect(() => {
    console.log('Shared files updated:', sharedFiles.length, sharedFiles);
  }, [sharedFiles]);


  return (
    <div className="app">
      <header className="app-header">
        <h1>P2P File Share</h1>
        <p>Share files directly between devices</p>
      </header>

      <main className="app-main">
        <UserName
          userName={userName}
          onUpdateName={updateUserName}
          isConnected={isConnected}
          connectedUser={connectedUser}
        />

        <RoomManager
          roomId={roomId}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          isHost={isHost}
        />

        {roomId && isHost && (
          <FileSelector
            onFileSelect={(file) => {
              selectFile(file);
              // If already connected, trigger file send
              if (isConnected && file) {
                // File will be sent automatically through the effect
              }
            }}
            selectedFile={fileToSend}
          />
        )}

        {(transferStatus !== 'idle') && (
          <ProgressBar
            progress={transferProgress}
            status={transferStatus}
          />
        )}

        {/* Debug button - remove in production */}
        <div style={{ margin: '1rem', textAlign: 'center' }}>
          <button 
            onClick={addTestFile}
            style={{ 
              padding: '0.5rem 1rem', 
              background: '#ff9800', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Add Test File (Debug)
          </button>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Shared Files Count: {sharedFiles.length}
          </p>
        </div>

        <SharedFiles
          sharedFiles={sharedFiles}
          onDownload={handleDownload}
        />

        {wakeLockActive && (
          <div className="wake-lock-indicator">
            Screen will stay awake during transfer
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Files are transferred directly between devices. No data is stored on servers.</p>
      </footer>
    </div>
  );
}

export default App
