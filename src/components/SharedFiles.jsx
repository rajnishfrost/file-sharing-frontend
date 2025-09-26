import React, { useState } from 'react';

const SharedFiles = ({ sharedFiles, onDownload }) => {
  const [selectedFile, setSelectedFile] = useState(null);

  if (sharedFiles.length === 0) {
    return (
      <div className="shared-files">
        <h3>Shared Files</h3>
        <p className="no-files">No files shared yet</p>
      </div>
    );
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleFileClick = (file) => {
    setSelectedFile(file);
  };

  const handleDownload = (file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderPreview = (file) => {
    if (file.isImage) {
      return (
        <img 
          src={file.url} 
          alt={file.name}
          className="file-preview-image"
          loading="lazy"
        />
      );
    } else if (file.isVideo) {
      return (
        <video 
          src={file.url} 
          className="file-preview-video"
          controls
          preload="metadata"
        />
      );
    } else {
      return (
        <div className="file-icon">
          📄
        </div>
      );
    }
  };

  return (
    <div className="shared-files">
      <h3>Shared Files ({sharedFiles.length})</h3>
      
      <div className="files-grid">
        {sharedFiles.map((file) => (
          <div 
            key={file.id} 
            className="file-card"
            onClick={() => handleFileClick(file)}
          >
            <div className="file-preview">
              {renderPreview(file)}
            </div>
            <div className="file-info">
              <h4 className="file-name" title={file.name}>
                {file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name}
              </h4>
              <p className="file-details">
                {formatFileSize(file.size)} • {file.sender}
              </p>
              <p className="file-date">
                {formatDate(file.timestamp)}
              </p>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(file);
                }}
                className="download-btn"
              >
                ⬇️ Download
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedFile && (
        <div className="file-modal" onClick={() => setSelectedFile(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedFile.name}</h3>
              <button 
                onClick={() => setSelectedFile(null)}
                className="close-btn"
              >
                ✕
              </button>
            </div>
            <div className="modal-preview">
              {selectedFile.isImage && (
                <img 
                  src={selectedFile.url} 
                  alt={selectedFile.name}
                  className="modal-image"
                />
              )}
              {selectedFile.isVideo && (
                <video 
                  src={selectedFile.url} 
                  controls
                  className="modal-video"
                />
              )}
              {!selectedFile.isImage && !selectedFile.isVideo && (
                <div className="file-info-modal">
                  <div className="large-file-icon">📄</div>
                  <p>File preview not available</p>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button 
                onClick={() => handleDownload(selectedFile)}
                className="btn-primary"
              >
                Download {selectedFile.name}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharedFiles;