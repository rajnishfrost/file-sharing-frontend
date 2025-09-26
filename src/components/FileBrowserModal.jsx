import { useState, useEffect } from 'react';
import './FileBrowserModal.css';

const FileBrowserModal = ({ isVisible, onClose, fileBrowser, onFileTransfer }) => {
  const [activeTab, setActiveTab] = useState('local');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [localFiles, setLocalFiles] = useState([]);
  const [remoteFiles, setRemoteFiles] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hasFileSystemAccess, setHasFileSystemAccess] = useState(false);

  useEffect(() => {
    if (fileBrowser) {
      setHasFileSystemAccess(fileBrowser.hasFileSystemAccess);
      
      // Set up file list update handler
      fileBrowser.onFileListUpdate = (files) => {
        setLocalFiles(files.local || []);
        setRemoteFiles(files.remote || []);
      };
    }
  }, [fileBrowser]);

  const handleBrowseFiles = async () => {
    if (!fileBrowser) return;
    
    setIsScanning(true);
    try {
      if (hasFileSystemAccess) {
        await fileBrowser.requestDirectoryAccess();
      } else {
        await fileBrowser.requestMediaAccess();
      }
      await fileBrowser.shareFileList();
    } catch (error) {
      console.error('Error browsing files:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileRequest = async (file) => {
    if (!fileBrowser) return;
    
    if (activeTab === 'remote') {
      await fileBrowser.requestFile(file.id);
    } else {
      // Local file - direct transfer
      try {
        const actualFile = await file.handle.getFile();
        if (onFileTransfer) {
          onFileTransfer(actualFile);
        }
      } catch (error) {
        console.error('Error accessing local file:', error);
      }
    }
  };

  const getFilteredFiles = () => {
    const files = activeTab === 'local' ? localFiles : remoteFiles;
    
    if (selectedCategory === 'all') return files;
    
    return files.filter(file => {
      switch (selectedCategory) {
        case 'images': return file.isImage;
        case 'videos': return file.isVideo;
        case 'audio': return file.isAudio;
        case 'documents': return file.isDocument;
        default: return true;
      }
    });
  };

  const formatFileSize = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getFileIcon = (file) => {
    if (file.isImage) return '🖼️';
    if (file.isVideo) return '🎥';
    if (file.isAudio) return '🎵';
    if (file.isDocument) return '📄';
    return '📁';
  };

  if (!isVisible) return null;

  return (
    <div className="file-browser-overlay" onClick={onClose}>
      <div className="file-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-browser-header">
          <h2>📁 File Browser</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="file-browser-content">
          {/* Action Buttons */}
          <div className="action-section">
            <button 
              className="browse-btn"
              onClick={handleBrowseFiles}
              disabled={isScanning}
            >
              {isScanning ? '🔄 Scanning...' : hasFileSystemAccess ? '📁 Browse Folders' : '📁 Select Files'}
            </button>
            
            {localFiles.length > 0 && (
              <button 
                className="share-btn"
                onClick={() => fileBrowser?.shareFileList()}
              >
                📤 Share File List
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="tab-section">
            <button 
              className={`tab ${activeTab === 'local' ? 'active' : ''}`}
              onClick={() => setActiveTab('local')}
            >
              📱 My Files ({localFiles.length})
            </button>
            <button 
              className={`tab ${activeTab === 'remote' ? 'active' : ''}`}
              onClick={() => setActiveTab('remote')}
            >
              📱 Their Files ({remoteFiles.length})
            </button>
          </div>

          {/* Category Filter */}
          <div className="category-section">
            {['all', 'images', 'videos', 'audio', 'documents'].map(category => (
              <button
                key={category}
                className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category === 'all' ? '📂 All' :
                 category === 'images' ? '🖼️ Images' :
                 category === 'videos' ? '🎥 Videos' :
                 category === 'audio' ? '🎵 Audio' :
                 '📄 Documents'}
              </button>
            ))}
          </div>

          {/* File List */}
          <div className="files-container">
            {getFilteredFiles().length === 0 ? (
              <div className="empty-state">
                {activeTab === 'local' ? (
                  <div>
                    <p>📁 No files found</p>
                    <p>Click "Browse Folders" to scan your files</p>
                  </div>
                ) : (
                  <div>
                    <p>📱 No files from connected device</p>
                    <p>Ask them to share their file list</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="files-grid">
                {getFilteredFiles().map(file => (
                  <div key={file.id} className="file-card" onClick={() => handleFileRequest(file)}>
                    <div className="file-preview">
                      {file.thumbnail ? (
                        <img src={file.thumbnail} alt={file.name} className="thumbnail" />
                      ) : (
                        <div className="file-icon-large">{getFileIcon(file)}</div>
                      )}
                    </div>
                    
                    <div className="file-info">
                      <div className="file-name" title={file.name}>
                        {file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name}
                      </div>
                      <div className="file-meta">
                        <span className="file-size">{formatFileSize(file.size)}</span>
                        {file.lastModified && (
                          <span className="file-date">
                            {new Date(file.lastModified).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="file-actions">
                      {activeTab === 'remote' ? (
                        <button className="download-icon" title="Download">⬇️</button>
                      ) : (
                        <button className="share-icon" title="Share">📤</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="file-browser-footer">
          <div className="capabilities-info">
            {hasFileSystemAccess ? (
              <span className="capability-good">✅ Full folder access available</span>
            ) : (
              <span className="capability-limited">⚠️ Limited to file picker (Chrome 86+ needed for folders)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileBrowserModal;