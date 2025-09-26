import React, { useState, useRef } from 'react';
import { useOnDemandTransfer } from '../hooks/useOnDemandTransfer';
import './OnDemandFileApp.css';

const OnDemandFileApp = () => {
  const {
    roomId,
    isConnected,
    status,
    availableFiles,
    mySharedFiles,
    downloadedFiles,
    activeDownloads,
    shareFiles,
    requestDownload,
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed,
    formatTime
  } = useOnDemandTransfer();

  const [roomInput, setRoomInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Handle file selection for sharing
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      console.log(`📋 Sharing metadata for ${files.length} file(s)`);
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

  // Handle download request
  const handleDownloadRequest = (fileInfo) => {
    console.log(`🔽 Requesting download: ${fileInfo.name}`);
    requestDownload(fileInfo);
  };

  // Get status styling
  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#4CAF50';
      case 'waiting': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected': return 'Connected - Ready for on-demand transfers';
      case 'waiting': return 'Waiting for peer...';
      default: return 'Not connected';
    }
  };

  return (
    <div className="ondemand-app">
      {/* Header */}
      <div className="app-header">
        <h1>📡 On-Demand File Transfer</h1>
        <p className="subtitle">Share file lists instantly, download on-demand • Support for 100GB+ files</p>
      </div>

      {/* Status Bar */}
      <div className="status-bar" style={{ backgroundColor: getStatusColor() }}>
        <span className="status-text">{getStatusText()}</span>
        {activeDownloads.length > 0 && (
          <span className="activity-indicator">
            {activeDownloads.length} active transfer{activeDownloads.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Connection Section */}
      <div className="connection-section">
        {!roomId ? (
          <div className="connection-controls">
            <button 
              className="btn btn-primary"
              onClick={createRoom}
              disabled={status !== 'disconnected'}
            >
              🏠 Create Room
            </button>
            <div className="divider">OR</div>
            <div className="join-room">
              <input
                type="text"
                placeholder="Enter room code"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                maxLength={6}
                className="room-input"
              />
              <button 
                className="btn btn-secondary"
                onClick={() => joinRoom(roomInput)}
                disabled={!roomInput || status !== 'disconnected'}
              >
                🚪 Join Room
              </button>
            </div>
          </div>
        ) : (
          <div className="room-info">
            <div className="room-display">
              <span className="label">Room Code:</span>
              <span className="code">{roomId}</span>
              <button 
                className="btn-copy"
                onClick={() => navigator.clipboard.writeText(roomId)}
              >
                📋 Copy
              </button>
            </div>
            <p className="room-hint">Share this code to connect devices</p>
          </div>
        )}
      </div>

      {/* File Sharing Section */}
      {isConnected && (
        <div className="sharing-section">
          <h2>📤 Share Files (Metadata Only)</h2>
          <p className="sharing-hint">
            Files are NOT transferred immediately. Only file information is shared. 
            Actual transfer starts when the other person clicks download.
          </p>
          
          {/* Drop Zone */}
          <div
            className={`drop-zone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-zone-content">
              <div className="drop-icon">📁</div>
              <p className="drop-text">
                Drag & drop files here or click to browse
              </p>
              <p className="drop-hint">
                Only metadata is shared • Supports ANY file size (even 100GB+)
              </p>
              <div className="file-buttons">
                <button 
                  className="btn btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  📄 Select Files
                </button>
                <button 
                  className="btn btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                >
                  📁 Select Folder
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
            directory="true"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Active Downloads */}
      {activeDownloads.length > 0 && (
        <div className="active-downloads">
          <h2>🔄 Active Transfers</h2>
          {activeDownloads.map((download) => (
            <div key={download.id} className="download-item">
              <div className="download-info">
                <div className="download-name">
                  {download.isUploading ? '📤' : '📥'} {download.fileName || download.name}
                </div>
                <div className="download-details">
                  <span>{download.progress?.toFixed(1) || 0}%</span>
                  <span>{formatSize(download.bytesTransferred || 0)} / {formatSize(download.fileSize || download.size)}</span>
                  <span>{formatSpeed(download.speed || 0)}</span>
                </div>
              </div>
              <div className="download-progress">
                <div 
                  className="progress-fill"
                  style={{ width: `${download.progress || 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Debug Info */}
      {isConnected && (
        <div className="debug-section">
          <h3>🔍 Debug Info</h3>
          <p>Connection Status: {status}</p>
          <p>My Shared Files: {mySharedFiles.length}</p>
          <p>Available Files from Peer: {availableFiles.length}</p>
          <p>Active Downloads: {activeDownloads.length}</p>
        </div>
      )}

      {/* Available Files from Peer */}
      {isConnected && (
        <div className="available-files">
          <h2>📥 Available Downloads ({availableFiles.length})</h2>
          <p className="section-hint">
            {availableFiles.length === 0 
              ? "No files shared by peer yet. When they share files, they'll appear here instantly!" 
              : "Files shared by your peer • Click download to start transfer"
            }
          </p>
          
          <div className="files-grid">
            {availableFiles.map((file) => (
              <div key={file.id} className="file-card">
                <div className="file-icon">
                  {getFileIcon(file.type)}
                </div>
                <div className="file-details">
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">{formatSize(file.size)}</div>
                  <div className="file-time">{new Date(file.timestamp).toLocaleTimeString()}</div>
                </div>
                <button 
                  className="btn-download"
                  onClick={() => handleDownloadRequest(file)}
                  title="Start download"
                >
                  ⬇️ Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show empty state when connected but no available files */}
      {isConnected && availableFiles.length === 0 && (
        <div className="empty-state">
          <h3>📥 Available Downloads</h3>
          <p>No files shared by peer yet. When they share files, they'll appear here instantly!</p>
        </div>
      )}

      {/* My Shared Files */}
      {mySharedFiles.length > 0 && (
        <div className="my-shared-files">
          <h2>📤 My Shared Files ({mySharedFiles.length})</h2>
          <p className="section-hint">Files you're sharing • Others can download these on-demand</p>
          
          <div className="files-grid">
            {mySharedFiles.map((file) => (
              <div key={file.id} className="file-card shared">
                <div className="file-icon">
                  {getFileIcon(file.type)}
                </div>
                <div className="file-details">
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">{formatSize(file.size)}</div>
                  <div className="file-time">{new Date(file.timestamp).toLocaleTimeString()}</div>
                </div>
                <div className="file-status">
                  <span className="shared-badge">📡 Shared</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Downloaded Files */}
      {downloadedFiles.length > 0 && (
        <div className="downloaded-files">
          <h2>💾 Downloaded Files ({downloadedFiles.length})</h2>
          <p className="section-hint">Files you've successfully downloaded</p>
          
          <div className="files-grid">
            {downloadedFiles.map((file) => (
              <div key={file.id} className="file-card downloaded">
                <div className="file-icon">
                  {getFileIcon(file.type)}
                </div>
                <div className="file-details">
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">{formatSize(file.size)}</div>
                  <div className="file-time">
                    Downloaded in {formatTime(file.downloadTime)}
                  </div>
                </div>
                <a 
                  href={file.url}
                  download={file.name}
                  className="btn-redownload"
                  title="Download again"
                >
                  💾 Save Again
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div className="features-section">
        <h3>✨ Key Features</h3>
        <div className="features-grid">
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <div className="feature-content">
              <div className="feature-title">Instant Sharing</div>
              <div className="feature-desc">Share file lists immediately, no waiting</div>
            </div>
          </div>
          <div className="feature">
            <span className="feature-icon">🎯</span>
            <div className="feature-content">
              <div className="feature-title">On-Demand Downloads</div>
              <div className="feature-desc">Download only what you want, when you want</div>
            </div>
          </div>
          <div className="feature">
            <span className="feature-icon">🚀</span>
            <div className="feature-content">
              <div className="feature-title">No Size Limits</div>
              <div className="feature-desc">Support for 100GB+ files with streaming</div>
            </div>
          </div>
          <div className="feature">
            <span className="feature-icon">💾</span>
            <div className="feature-content">
              <div className="feature-title">No Storage Waste</div>
              <div className="feature-desc">Files stay on sender's device until requested</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to get file icon
const getFileIcon = (mimeType) => {
  if (!mimeType) return '📄';
  
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '📦';
  if (mimeType.includes('text/') || mimeType.includes('json') || mimeType.includes('xml')) return '📝';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📈';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📃';
  
  return '📎';
};

export default OnDemandFileApp;