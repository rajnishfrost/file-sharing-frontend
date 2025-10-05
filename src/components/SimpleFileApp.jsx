import { useState, useRef } from 'react';
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
    downloadQueue,
    isDownloadingAll,
    shareFiles,
    requestDownload,
    downloadAll,
    refreshAvailableFiles,
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed
  } = useOnDemandTransfer();

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
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {availableFiles.length > 0 && (
                      <button
                        className="btn primary"
                        onClick={downloadAll}
                        disabled={isDownloadingAll || activeDownloads.length > 0}
                        style={{
                          backgroundColor: isDownloadingAll ? '#888' : '#4CAF50',
                          color: 'white',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: 'none',
                          cursor: isDownloadingAll || activeDownloads.length > 0 ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {isDownloadingAll ? '⏳ Downloading...' : '⬇️ Download All'}
                      </button>
                    )}
                    <button
                      className="btn refresh"
                      onClick={refreshAvailableFiles}
                      title="Refresh list"
                    >
                      🔄 Refresh
                    </button>
                  </div>
                </div>

                <p className="hint">
                  Files shared by your peer • One file downloads at a time
                  {downloadQueue.length > 0 && (
                    <span style={{ color: '#FF9800', marginLeft: '10px' }}>
                      📋 {downloadQueue.length} file{downloadQueue.length > 1 ? 's' : ''} in queue
                    </span>
                  )}
                </p>

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
                    {availableFiles.map((file) => {
                      const isQueued = downloadQueue.find(f => f.id === file.id);
                      const isDownloading = activeDownloads.find(d => d.fileId === file.id || d.fileName === file.name);
                      
                      return (
                        <div key={file.id} className="file-item">
                          <span className="icon">{getFileIcon(file.type)}</span>
                          <div className="details">
                            <div className="name">{file.name}</div>
                            <div className="size">{formatSize(file.size)}</div>
                          </div>
                          {isDownloading ? (
                            <span style={{ color: '#4CAF50', fontWeight: 'bold' }}>
                              ⏳ Downloading...
                            </span>
                          ) : isQueued ? (
                            <span style={{ color: '#FF9800' }}>
                              📋 In Queue
                            </span>
                          ) : (
                            <button
                              className="btn download custom-button"
                              onClick={() => requestDownload(file)}
                              disabled={activeDownloads.length > 0}
                              style={{
                                opacity: activeDownloads.length > 0 ? 0.5 : 1,
                                cursor: activeDownloads.length > 0 ? 'not-allowed' : 'pointer'
                              }}
                            >
                              ⬇️ Download
                            </button>
                          )}
                        </div>
                      );
                    })}
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