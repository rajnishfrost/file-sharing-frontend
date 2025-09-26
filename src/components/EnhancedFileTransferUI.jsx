import React, { useState, useRef } from 'react';
import { useEnhancedFileTransfer } from '../hooks/useEnhancedFileTransfer';
import './EnhancedFileTransferUI.css';

const EnhancedFileTransferUI = () => {
  const {
    roomId,
    isConnected,
    status,
    currentTransfer,
    transfers,
    transferSpeed,
    sharedFiles,
    createRoom,
    joinRoom,
    sendFiles,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    downloadFile,
    clearSharedFiles,
    formatSize,
    formatSpeed,
    formatTime
  } = useEnhancedFileTransfer();

  const [roomInput, setRoomInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      sendFiles(files);
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
      sendFiles(files);
    }
  };

  // Get status color
  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#4CAF50';
      case 'waiting': return '#FF9800';
      case 'transferring': return '#2196F3';
      default: return '#9E9E9E';
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case 'connected': return '✅';
      case 'waiting': return '⏳';
      case 'transferring': return '📤';
      default: return '🔌';
    }
  };

  return (
    <div className="enhanced-transfer-container">
      {/* Header */}
      <div className="transfer-header">
        <h1>Enhanced File Transfer</h1>
        <p className="subtitle">Transfer files up to 100GB+ directly between devices</p>
      </div>

      {/* Connection Status */}
      <div className="status-bar" style={{ backgroundColor: getStatusColor() }}>
        <span className="status-icon">{getStatusIcon()}</span>
        <span className="status-text">
          {status === 'disconnected' && 'Not Connected'}
          {status === 'waiting' && 'Waiting for peer...'}
          {status === 'connected' && 'Connected - Ready to transfer'}
          {status === 'transferring' && 'Transfer in progress...'}
        </span>
        {transferSpeed > 0 && (
          <span className="speed-indicator">
            {formatSpeed(transferSpeed)}
          </span>
        )}
      </div>

      {/* Connection Controls */}
      <div className="connection-section">
        {!roomId ? (
          <div className="connection-start">
            <button 
              className="btn btn-primary"
              onClick={createRoom}
              disabled={status !== 'disconnected'}
            >
              Create Room
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
                Join Room
              </button>
            </div>
          </div>
        ) : (
          <div className="room-info">
            <div className="room-code">
              <span className="label">Room Code:</span>
              <span className="code">{roomId}</span>
              <button 
                className="btn-copy"
                onClick={() => navigator.clipboard.writeText(roomId)}
              >
                Copy
              </button>
            </div>
            {status === 'waiting' && (
              <p className="waiting-message">
                Share this code with someone to start transferring files
              </p>
            )}
          </div>
        )}
      </div>

      {/* File Transfer Section */}
      {isConnected && (
        <div className="transfer-section">
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
                Supports single or multiple files up to 100GB+
              </p>
              <div className="file-buttons">
                <button 
                  className="btn btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Select Files
                </button>
                <button 
                  className="btn btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                >
                  Select Folder
                </button>
              </div>
            </div>
          </div>

          {/* Hidden file inputs */}
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

          {/* Current Transfer Progress */}
          {currentTransfer && (
            <div className="transfer-progress">
              <div className="progress-header">
                <h3>{currentTransfer.isReceiving ? 'Receiving Files' : 'Sending Files'}</h3>
                <div className="progress-controls">
                  {!currentTransfer.isPaused ? (
                    <button 
                      className="btn-icon"
                      onClick={() => pauseTransfer()}
                      title="Pause"
                    >
                      ⏸️
                    </button>
                  ) : (
                    <button 
                      className="btn-icon"
                      onClick={() => resumeTransfer()}
                      title="Resume"
                    >
                      ▶️
                    </button>
                  )}
                  <button 
                    className="btn-icon"
                    onClick={() => cancelTransfer()}
                    title="Cancel"
                  >
                    ❌
                  </button>
                </div>
              </div>
              
              <div className="progress-stats">
                <div className="stat">
                  <span className="stat-label">Progress:</span>
                  <span className="stat-value">{currentTransfer.progress?.toFixed(1)}%</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Transferred:</span>
                  <span className="stat-value">
                    {formatSize(currentTransfer.bytesTransferred || 0)} / {formatSize(currentTransfer.totalBytes || 0)}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Speed:</span>
                  <span className="stat-value">{formatSpeed(currentTransfer.speed || transferSpeed)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Time Remaining:</span>
                  <span className="stat-value">{formatTime(currentTransfer.remainingTime)}</span>
                </div>
              </div>

              <div className="progress-bar-container">
                <div 
                  className="progress-bar-fill"
                  style={{ width: `${currentTransfer.progress || 0}%` }}
                />
              </div>

              {/* Individual file progress */}
              {currentTransfer.files && currentTransfer.files.length > 0 && (
                <div className="files-progress">
                  {currentTransfer.files.map((file, index) => (
                    <div key={index} className="file-progress-item">
                      <span className="file-name">{file.name}</span>
                      <div className="file-progress-bar">
                        <div 
                          className="file-progress-fill"
                          style={{ width: `${file.progress || 0}%` }}
                        />
                      </div>
                      <span className="file-progress-text">{(file.progress || 0).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shared Files */}
          {sharedFiles.length > 0 && (
            <div className="shared-files">
              <div className="shared-files-header">
                <h3>Transferred Files ({sharedFiles.length})</h3>
                <button 
                  className="btn btn-sm"
                  onClick={clearSharedFiles}
                >
                  Clear All
                </button>
              </div>
              
              <div className="files-list">
                {sharedFiles.map((file) => (
                  <div key={file.id} className="file-item">
                    <div className="file-icon">
                      {file.type?.startsWith('image/') ? '🖼️' :
                       file.type?.startsWith('video/') ? '🎬' :
                       file.type?.startsWith('audio/') ? '🎵' :
                       file.type?.includes('pdf') ? '📄' :
                       file.type?.includes('zip') || file.type?.includes('rar') ? '📦' :
                       '📎'}
                    </div>
                    <div className="file-details">
                      <div className="file-name">{file.name}</div>
                      <div className="file-meta">
                        <span className="file-size">{formatSize(file.size)}</span>
                        <span className="file-time">{new Date(file.timestamp).toLocaleTimeString()}</span>
                        {file.isOwn && <span className="file-badge">Sent</span>}
                        {!file.isOwn && <span className="file-badge received">Received</span>}
                      </div>
                    </div>
                    <button 
                      className="btn-download"
                      onClick={() => downloadFile(file)}
                      title="Download"
                    >
                      ⬇️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transfer History */}
          {transfers.length > 0 && (
            <div className="transfer-history">
              <h3>Transfer History</h3>
              <div className="history-list">
                {transfers.map((transfer) => (
                  <div key={transfer.id} className="history-item">
                    <span className="history-type">
                      {transfer.type === 'send' ? '📤' : '📥'}
                    </span>
                    <span className="history-files">
                      {transfer.files.length} file{transfer.files.length !== 1 ? 's' : ''}
                    </span>
                    <span className="history-time">
                      {new Date(transfer.startTime).toLocaleTimeString()}
                    </span>
                    <span className={`history-status ${transfer.status}`}>
                      {transfer.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Features */}
      <div className="features-section">
        <h3>Features</h3>
        <div className="features-grid">
          <div className="feature">
            <span className="feature-icon">🚀</span>
            <span className="feature-text">100GB+ File Support</span>
          </div>
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <span className="feature-text">Direct P2P Transfer</span>
          </div>
          <div className="feature">
            <span className="feature-icon">📁</span>
            <span className="feature-text">Multiple Files & Folders</span>
          </div>
          <div className="feature">
            <span className="feature-icon">⏸️</span>
            <span className="feature-text">Pause & Resume</span>
          </div>
          <div className="feature">
            <span className="feature-icon">🔒</span>
            <span className="feature-text">Secure & Private</span>
          </div>
          <div className="feature">
            <span className="feature-icon">📊</span>
            <span className="feature-text">Real-time Progress</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedFileTransferUI;