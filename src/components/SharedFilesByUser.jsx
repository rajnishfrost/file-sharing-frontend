import React, { useState } from 'react';

const SharedFilesByUser = ({ sharedFiles }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  
  // Group files by sender
  const filesBySender = sharedFiles.reduce((acc, file) => {
    const sender = file.sender || 'Unknown';
    if (!acc[sender]) {
      acc[sender] = [];
    }
    acc[sender].push(file);
    return acc;
  }, {});
  
  const handleDownload = (file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };
  
  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };
  
  return (
    <div className="shared-files-by-user">
      <h3>Shared Files</h3>
      {Object.keys(filesBySender).length === 0 ? (
        <p className="no-files">No files shared yet</p>
      ) : (
        <div className="sender-sections">
          {Object.entries(filesBySender).map(([sender, files]) => (
            <div key={sender} className="sender-section">
              <div className="sender-header">
                <div className="sender-avatar">
                  {sender.charAt(0).toUpperCase()}
                </div>
                <h4>{sender}</h4>
                <span className="file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="sender-files">
                {files.map(file => (
                  <div key={file.id} className="file-item" onClick={() => setSelectedFile(file)}>
                    <div className="file-preview-small">
                      {file.isImage ? (
                        <img src={file.url} alt={file.name} />
                      ) : file.isVideo ? (
                        <video src={file.url} />
                      ) : (
                        <div className="file-icon">📄</div>
                      )}
                    </div>
                    <div className="file-info">
                      <p className="file-name">{file.name}</p>
                      <p className="file-meta">
                        {formatFileSize(file.size)} • {formatDate(file.timestamp)}
                      </p>
                    </div>
                    <button 
                      className="download-btn-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(file);
                      }}
                    >
                      ⬇
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {selectedFile && (
        <div className="file-modal" onClick={() => setSelectedFile(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedFile.name}</h3>
              <button className="close-btn" onClick={() => setSelectedFile(null)}>×</button>
            </div>
            <div className="modal-preview">
              {selectedFile.isImage ? (
                <img src={selectedFile.url} alt={selectedFile.name} className="modal-image" />
              ) : selectedFile.isVideo ? (
                <video src={selectedFile.url} controls className="modal-video" />
              ) : (
                <div className="file-info-modal">
                  <div className="large-file-icon">📄</div>
                  <p>{selectedFile.name}</p>
                  <p>{formatFileSize(selectedFile.size)}</p>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => handleDownload(selectedFile)}>
                Download File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharedFilesByUser;