import React, { useState, useRef } from 'react';
import { useOnDemandTransfer } from '../hooks/useOnDemandTransferDebug';
import './SimpleFileApp.css';

const SimpleFileApp = () => {
  const {
    roomId,
    isConnected,
    status,
    availableFiles,
    mySharedFiles,
    activeDownloads,
    shareFiles,
    requestDownload,
    refreshAvailableFiles,
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed
  } = useOnDemandTransfer();

  const [showAddToHome, setShowAddToHome] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Listen for the install prompt
  React.useEffect(() => {
    console.log('Setting up install prompt listener');

    const handler = (e) => {
      console.log('beforeinstallprompt event fired!');
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      console.log('App is already installed');
    } else {
      console.log('App is not installed yet');
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleAddToHome = async () => {
    console.log('Add to Home clicked');
    console.log('Deferred prompt available:', !!deferredPrompt);

    if (deferredPrompt) {
      try {
        // Show native install prompt
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('Install prompt outcome:', outcome);
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
          alert('App installed successfully!');
        }
      } catch (error) {
        console.error('Install prompt error:', error);
        setShowAddToHome(true);
      }
    } else {
      // Fallback: show manual instructions
      console.log('Showing manual instructions');
      setShowAddToHome(!showAddToHome);
    }
  };

  const [roomInput, setRoomInput] = useState('');
  const [activeTab, setActiveTab] = useState('share'); // 'share' or 'download'
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      shareFiles(files);
    }
  };

  // Handle drag and drop
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      shareFiles(files);
    }
  };

  // Refresh is now handled by the hook

  // Get status color
  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#4CAF50';
      case 'waiting': return '#FF9800';
      case 'mobile-disconnected': return '#FF5722';
      default: return '#9E9E9E';
    }
  };

  // Get file icon
  const getFileIcon = (mimeType) => {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
    return '📄';
  };

  return (
    <div className="simple-file-app">

      <div style={{ textAlign: 'center', margin: '10px 0' }}>
        <button
          className='add-to-home-button'
          onClick={handleAddToHome}
          style={{
            background: deferredPrompt ? '#4CAF50' : '#FF9800',
            color: 'white',
            border: 'none',
            padding: '12px 20px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            marginRight: '10px'
          }}
        >
          📱 Add to Home
        </button>
      </div>

      {showAddToHome && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            animation: 'fadeIn 0.3s ease-out',
            padding: '20px'
          }}
          onClick={() => setShowAddToHome(false)}
        >
          <style>
            {`
              @keyframes fadeIn {
                from {
                  opacity: 0;
                }
                to {
                  opacity: 1;
                }
              }
              @keyframes slideUp {
                from {
                  transform: translateY(30px);
                  opacity: 0;
                }
                to {
                  transform: translateY(0);
                  opacity: 1;
                }
              }
            `}
          </style>
          <div
            style={{
              background: 'white',
              padding: '25px',
              borderRadius: '16px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              animation: 'slideUp 0.4s ease-out',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowAddToHome(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                color: '#ff0000',
                fontSize: '28px',
                fontWeight: 'bold',
                cursor: 'pointer',
                lineHeight: '1',
                padding: '5px',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.target.style.color = '#cc0000';
                e.target.style.transform = 'scale(1.2)';
              }}
              onMouseOut={(e) => {
                e.target.style.color = '#ff0000';
                e.target.style.transform = 'scale(1)';
              }}
            >
              ×
            </button>

            <h4 style={{ margin: '0 0 20px 0', color: '#333', fontSize: '22px', fontWeight: '700', textAlign: 'center' }}>
              📱 Add to Home Screen
            </h4>

            <div style={{ background: '#f0f4ff', padding: '15px', borderRadius: '10px', marginBottom: '15px', border: '2px solid #e0e8ff' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#333', fontWeight: '600' }}>
                🤖 Android Chrome:
              </p>
              <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', color: '#555', lineHeight: '1.8' }}>
                <li>Tap the menu button (⋮) in top right corner</li>
                <li>Look for "Add to Home screen" or "Install app"</li>
                <li>Tap it and confirm "Add" or "Install"</li>
                <li>App icon will appear on your home screen</li>
              </ol>
            </div>

            <div style={{ background: '#fff3e0', padding: '15px', borderRadius: '10px', marginBottom: '15px', border: '2px solid #ffe0b2' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#333', fontWeight: '600' }}>
                🍎 iPhone/iPad Safari:
              </p>
              <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', color: '#555', lineHeight: '1.8' }}>
                <li>Tap the Share button at the bottom</li>
                <li>Scroll and tap "Add to Home Screen"</li>
                <li>Tap "Add" in top right</li>
                <li>App icon will appear on your home screen</li>
              </ol>
            </div>

            <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '10px', border: '2px solid #c8e6c9' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#333', fontWeight: '600' }}>
                💻 Desktop (Chrome/Edge):
              </p>
              <p style={{ margin: '0', fontSize: '14px', color: '#555', lineHeight: '1.8' }}>
                Look for the install icon (⊕ or computer icon) in the address bar and click it.
              </p>
            </div>

            <button
              onClick={() => setShowAddToHome(false)}
              style={{
                marginTop: '20px',
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
              onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
              onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="header">
        <h1>📡 File Transfer</h1>
        <p>Share metadata instantly • Download on-demand • Support 100GB+ files</p>
      </div>

      {/* Status */}
      <div className="status" style={{ backgroundColor: getStatusColor() }}>
        {status === 'connected' ? '✅ Connected' :
          status === 'waiting' ? '⏳ Waiting for peer...' :
            status === 'mobile-disconnected' ? '📱 Mobile browser backgrounded - keep app open!' :
              '🔌 Not connected'}
        {activeDownloads.length > 0 && (
          <span className="transfers">({activeDownloads.length} active)</span>
        )}
      </div>

      {/* Connection */}
      {!roomId ? (
        <div className="connection">
          <button
            className="btn primary"
            onClick={createRoom}
          >
            🏠 Create Room
          </button>
          <div className="or">OR</div>
          <div className="join">
            <input
              type="text"
              placeholder="Room Code"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button
              className="btn secondary"
              onClick={() => joinRoom(roomInput)}
              disabled={!roomInput}
            >
              🚪 Join
            </button>
          </div>
        </div>
      ) : (
        <div className="room-info">
          <span>Room: <strong>{roomId}</strong></span>
          <button
            className="btn-copy"
            onClick={() => navigator.clipboard.writeText(roomId)}
          >
            📋 Copy
          </button>
        </div>
      )}

      {/* Active Downloads Progress */}
      {activeDownloads.length > 0 && (
        <div className="active-transfers">
          <h3>🔄 Active Transfers</h3>
          {activeDownloads.map((transfer) => (
            <div key={transfer.id} className="transfer-item">
              <div className="transfer-info">
                <span className="name">
                  {transfer.isUploading ? '📤' : '📥'} {transfer.fileName || transfer.name}
                </span>
                <span className="progress">
                  {(transfer.progress || 0).toFixed(1)}% • {formatSpeed(transfer.speed || 0)}
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${transfer.progress || 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs - Only show when connected */}
      {isConnected && (
        <div className="tabs-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'share' ? 'active' : ''}`}
              onClick={() => setActiveTab('share')}
            >
              📤 My Shared Files ({mySharedFiles.length})
            </button>
            <button
              className={`tab ${activeTab === 'download' ? 'active' : ''}`}
              onClick={() => setActiveTab('download')}
            >
              📥 Available Downloads ({availableFiles.length})
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">

            {/* Share Tab */}
            {activeTab === 'share' && (
              <div className="share-tab">
                <h3>📤 Share Files</h3>
                <p className="hint">Files stay on your device until someone downloads them</p>

                {/* Drop Zone */}
                <div
                  className={`drop-zone ${dragActive ? 'active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="drop-content">
                    <div className="icon">📁</div>
                    <p>Drop files here or click to browse</p>
                    <div className="buttons">
                      <button
                        className="btn outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        📄 Files
                      </button>
                      <button
                        className="btn outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          folderInputRef.current?.click();
                        }}
                      >
                        📁 Folder
                      </button>
                    </div>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  webkitdirectory="true"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {/* My Shared Files List */}
                {mySharedFiles.length > 0 && (
                  <div className="files-list">
                    <h4>📤 Shared Files ({mySharedFiles.length})</h4>
                    {mySharedFiles.map((file) => (
                      <div key={file.id} className="file-item">
                        <span className="icon">{getFileIcon(file.type)}</span>
                        <div className="details">
                          <div className="name">{file.name}</div>
                          <div className="size">{formatSize(file.size)}</div>
                        </div>
                        <span className="status">🟢 Shared</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Download Tab */}
            {activeTab === 'download' && (
              <div className="download-tab">
                <div className="tab-header">
                  <h3>📥 Available Downloads</h3>
                  <button
                    className="btn refresh"
                    onClick={refreshAvailableFiles}
                    title="Refresh list"
                  >
                    🔄 Refresh
                  </button>
                </div>

                <p className="hint">Files shared by your peer • Click download to start transfer</p>

                {availableFiles.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📭</div>
                    <p>No files shared by peer yet</p>
                    <button
                      className="btn outline"
                      onClick={refreshAvailableFiles}
                    >
                      🔄 Check for files
                    </button>
                  </div>
                ) : (
                  <div className="files-list">
                    {availableFiles.map((file) => (
                      <div key={file.id} className="file-item">
                        <span className="icon">{getFileIcon(file.type)}</span>
                        <div className="details">
                          <div className="name">{file.name}</div>
                          <div className="size">{formatSize(file.size)}</div>
                        </div>
                        <button
                          className="btn download custom-button"
                          onClick={() => requestDownload(file)}
                        >
                          ⬇️ Download
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleFileApp;