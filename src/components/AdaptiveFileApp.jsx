import React, { useState, useRef } from 'react';
import { useAdaptiveRateTransfer } from '../hooks/useAdaptiveRateTransfer';
import './AdaptiveFileApp.css';

const AdaptiveFileApp = () => {
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
    formatSpeed,
    getAdaptiveInfo
  } = useAdaptiveRateTransfer();

  const [roomInput, setRoomInput] = useState('');
  const [activeTab, setActiveTab] = useState('share');
  const [dragActive, setDragActive] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Get adaptive control metrics
  const adaptiveInfo = getAdaptiveInfo();

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

  // Get congestion color
  const getCongestionColor = (level) => {
    switch (level) {
      case 'high': return '#FF5722';
      case 'moderate': return '#FF9800';
      case 'normal': return '#4CAF50';
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
    <div className="adaptive-file-app">
      {/* Header */}
      <div className="header">
        <h1>🚀 Adaptive File Transfer</h1>
        <p>Smart rate control • Dynamic chunk sizing • Backpressure handling</p>
      </div>

      {/* Network Metrics Panel */}
      {showMetrics && isConnected && (
        <div className="metrics-panel">
          <div className="metric">
            <span className="label">Upload</span>
            <span className="value">{formatSpeed(adaptiveInfo.uploadRate || 0)}</span>
          </div>
          <div className="metric">
            <span className="label">Download</span>
            <span className="value">{formatSpeed(adaptiveInfo.downloadRate || 0)}</span>
          </div>
          <div className="metric">
            <span className="label">RTT</span>
            <span className="value">{adaptiveInfo.rtt || 0}ms</span>
          </div>
          <div className="metric">
            <span className="label">Chunk Size</span>
            <span className="value">{formatSize(adaptiveInfo.chunkSize || 16384)}</span>
          </div>
          <div className="metric">
            <span className="label">Congestion</span>
            <span 
              className="value status-badge" 
              style={{ backgroundColor: getCongestionColor(adaptiveInfo.congestionLevel) }}
            >
              {adaptiveInfo.congestionLevel || 'normal'}
            </span>
          </div>
          <div className="metric">
            <span className="label">Buffer</span>
            <div className="buffer-bar">
              <div 
                className="buffer-fill"
                style={{ 
                  width: `${adaptiveInfo.bufferPressure * 100 || 0}%`,
                  backgroundColor: adaptiveInfo.bufferPressure > 0.7 ? '#FF5722' : 
                                   adaptiveInfo.bufferPressure > 0.4 ? '#FF9800' : '#4CAF50'
                }}
              />
            </div>
          </div>
          <button 
            className="metrics-toggle"
            onClick={() => setShowMetrics(false)}
            title="Hide metrics"
          >
            ✕
          </button>
        </div>
      )}

      {/* Show metrics button when hidden */}
      {!showMetrics && isConnected && (
        <button 
          className="show-metrics-btn"
          onClick={() => setShowMetrics(true)}
        >
          📊 Show Metrics
        </button>
      )}

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

      {/* Active Downloads with Adaptive Info */}
      {activeDownloads.length > 0 && (
        <div className="active-transfers">
          <h3>🔄 Active Transfers</h3>
          {activeDownloads.map((transfer) => (
            <div key={transfer.id} className="transfer-item adaptive">
              <div className="transfer-info">
                <span className="name">
                  {transfer.status === 'paused' ? '⏸️' : 
                   transfer.status === 'resuming' ? '🔄' :
                   transfer.isUploading ? '📤' : '📥'} {transfer.fileName || transfer.name}
                  {transfer.status === 'paused' && <span className="status-badge paused">PAUSED</span>}
                  {transfer.status === 'resuming' && <span className="status-badge resuming">RESUMING</span>}
                </span>
                <div className="transfer-stats">
                  <span className="progress">
                    {(transfer.progress || 0).toFixed(1)}%
                  </span>
                  <span className="speed">
                    {formatSpeed(transfer.speed || 0)}
                  </span>
                  {transfer.adaptiveInfo && (
                    <>
                      <span className="chunk-size">
                        Chunk: {formatSize(transfer.adaptiveInfo.chunkSize || 16384)}
                      </span>
                      <span 
                        className="congestion-badge"
                        style={{ 
                          backgroundColor: getCongestionColor(transfer.adaptiveInfo.congestion)
                        }}
                      >
                        {transfer.adaptiveInfo.congestion || 'normal'}
                      </span>
                      {transfer.adaptiveInfo.bufferPressure > 0 && (
                        <span className="buffer-pressure">
                          Buffer: {transfer.adaptiveInfo.bufferPressure.toFixed(0)}%
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ 
                    width: `${transfer.progress || 0}%`,
                    backgroundColor: transfer.adaptiveInfo?.congestion === 'high' ? '#FF5722' :
                                     transfer.adaptiveInfo?.congestion === 'moderate' ? '#FF9800' :
                                     '#4CAF50'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
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
                <p className="hint">Files use adaptive rate control for optimal speed</p>
                
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
                    <p className="sub-hint">Adaptive transfer automatically adjusts to network conditions</p>
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
                        <span className="status">🟢 Ready</span>
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
                
                <p className="hint">Downloads adapt to your connection speed automatically</p>

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
                          className="btn download"
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

export default AdaptiveFileApp;