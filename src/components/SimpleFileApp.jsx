import { useState, useRef, useEffect } from 'react';
import { useOnDemandTransfer } from '../hooks/useOnDemandTransferDebug';
import SimpleSpeedControl from './SimpleSpeedControl';
import { adaptiveAgent } from '../utils/SimpleAdaptiveAgent';
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
    completedDownloads,
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
  const [downloadAllClicked, setDownloadAllClicked] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Handle speed change from control
  const handleSpeedChange = (newSpeed) => {
    console.log(`🎛️ User changed speed to: ${newSpeed} MBps`);
    adaptiveAgent.setUploadSpeed(newSpeed);
  };

  // Reset download all clicked state when downloads complete
  useEffect(() => {
    if (!isDownloadingAll && downloadAllClicked) {
      console.log('✅ Downloads completed, resetting Download All button');
      setDownloadAllClicked(false);
    }
  }, [isDownloadingAll, downloadAllClicked]);

  // Handle download all with immediate button disable
  const handleDownloadAll = () => {
    if (downloadAllClicked) {
      console.log('🚫 Download All button already clicked, ignoring');
      return;
    }
    
    setDownloadAllClicked(true);
    console.log('🎯 Download All button clicked - button disabled');
    
    downloadAll();
    
    // Reset after a delay
    setTimeout(() => {
      setDownloadAllClicked(false);
    }, 2000);
  };

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
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
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

      {/* Speed Control - Only show when connected */}
      {isConnected && (
        <SimpleSpeedControl 
          onSpeedChange={handleSpeedChange}
          initialSpeed={0.1}
        />
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
                        onClick={handleDownloadAll}
                        disabled={downloadAllClicked || isDownloadingAll || activeDownloads.length > 0}
                        style={{
                          backgroundColor: downloadAllClicked ? '#666' : isDownloadingAll ? '#FF9800' : activeDownloads.length > 0 ? '#888' : '#4CAF50',
                          color: 'white',
                          padding: '7px 14px',
                          borderRadius: '7px',
                          border: 'none',
                          cursor: downloadAllClicked || isDownloadingAll || activeDownloads.length > 0 ? 'not-allowed' : 'pointer',
                          fontWeight: '500',
                          fontSize: '13px',
                          transition: 'all 0.2s ease',
                          opacity: downloadAllClicked ? 0.6 : 1
                        }}
                        title={
                          downloadAllClicked
                            ? 'Processing Download All request...'
                            : isDownloadingAll 
                              ? `Downloading all files (${downloadQueue.length} remaining)` 
                              : activeDownloads.length > 0 
                                ? 'Wait for current download to complete' 
                                : `Download all ${availableFiles.length} files`
                        }
                      >
                        {downloadAllClicked
                          ? '🔄 Processing...'
                          : isDownloadingAll 
                            ? `⏳ Downloading All (${downloadQueue.length + 1}/${availableFiles.length})` 
                            : '⬇️ Download All'}
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
                      const downloadingFile = activeDownloads.find(d => 
                        (d.fileId === file.id || d.fileName === file.name) && d.isDownloading
                      );
                      const isCompleted = completedDownloads.has(file.id);
                      
                      return (
                        <div 
                          key={file.id} 
                          className="file-item"
                          style={{
                            backgroundColor: isCompleted ? '#f0f8f0' : downloadingFile ? '#e8f5e9' : 'transparent',
                            border: isCompleted ? '2px solid #2E7D32' : downloadingFile ? '2px solid #4CAF50' : '1px solid #e0e0e0',
                            padding: '12px',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            transition: 'all 0.3s ease',
                            opacity: isCompleted ? 0.8 : 1
                          }}
                        >
                          <span className="icon">{getFileIcon(file.type)}</span>
                          <div className="details" style={{ flex: 1 }}>
                            <div className="name">
                              {isCompleted && <span style={{ color: '#2E7D32', marginRight: '8px', fontWeight: 'bold' }}>✅</span>}
                              {file.name}
                              {isCompleted && <span style={{ color: '#2E7D32', marginLeft: '8px', fontSize: '12px' }}>(Downloaded)</span>}
                            </div>
                            <div className="size">{formatSize(file.size)}</div>
                            
                            {/* Show download progress and speed for active download */}
                            {downloadingFile && (
                              <div style={{ marginTop: '8px' }}>
                                <div style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '10px',
                                  fontSize: '12px',
                                  color: '#4CAF50'
                                }}>
                                  <span>📥 {(downloadingFile.progress || 0).toFixed(1)}%</span>
                                  <span>• {formatSpeed(downloadingFile.speed || 0)}</span>
                                  <span>• {downloadingFile.receivedChunks}/{downloadingFile.totalChunks} chunks</span>
                                </div>
                                <div style={{
                                  width: '100%',
                                  height: '4px',
                                  backgroundColor: '#e0e0e0',
                                  borderRadius: '2px',
                                  marginTop: '4px',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    width: `${downloadingFile.progress || 0}%`,
                                    height: '100%',
                                    backgroundColor: '#4CAF50',
                                    transition: 'width 0.3s ease'
                                  }} />
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {/* Button/Status area */}
                          {isCompleted ? (
                            <div style={{ 
                              color: '#2E7D32', 
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}>
                              ✅ Downloaded
                            </div>
                          ) : downloadingFile ? (
                            <div style={{ 
                              color: '#4CAF50', 
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}>
                              <span className="spinner" style={{ 
                                display: 'inline-block',
                                animation: 'spin 1s linear infinite'
                              }}>⏳</span>
                              Downloading
                            </div>
                          ) : isQueued ? (
                            <span style={{ 
                              color: '#FF9800',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}>
                              📋 Queued
                            </span>
                          ) : (
                            <button
                              className="btn download custom-button"
                              onClick={() => requestDownload(file)}
                              disabled={activeDownloads.length > 0 || isDownloadingAll}
                              style={{
                                opacity: (activeDownloads.length > 0 || isDownloadingAll) ? 0.5 : 1,
                                cursor: (activeDownloads.length > 0 || isDownloadingAll) ? 'not-allowed' : 'pointer',
                                backgroundColor: (activeDownloads.length > 0 || isDownloadingAll) ? '#ccc' : '#2196F3',
                                color: 'white',
                                border: 'none',
                                padding: '7px 14px',
                                borderRadius: '5px',
                                fontSize: '13px',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                              }}
                              title={isDownloadingAll ? 'Download All in progress' : ''}
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