// File Browser System for Cross-Device File Sharing
class FileBrowser {
  constructor(peer) {
    this.peer = peer;
    this.localFiles = new Map();
    this.remoteFiles = new Map();
    this.sharedDirectories = [];
    this.onFileListUpdate = null;
    this.onFilePreview = null;
    
    // Browser API availability
    this.hasFileSystemAccess = 'showDirectoryPicker' in window;
    this.hasMediaDevices = 'mediaDevices' in navigator;
    
    console.log('🗂️ File Browser initialized');
    console.log('📁 File System Access API:', this.hasFileSystemAccess ? 'Available' : 'Not available');
  }

  // Request access to user's directories (Chrome 86+)
  async requestDirectoryAccess() {
    if (!this.hasFileSystemAccess) {
      throw new Error('File System Access API not supported in this browser');
    }

    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'read',
        startIn: 'pictures' // Start in Pictures folder
      });
      
      console.log('📁 Directory access granted:', dirHandle.name);
      await this.scanDirectory(dirHandle);
      return dirHandle;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('📁 Directory access cancelled by user');
      } else {
        console.error('❌ Directory access error:', error);
      }
      throw error;
    }
  }

  // Scan directory and build file tree
  async scanDirectory(dirHandle, path = '') {
    const files = [];
    const currentPath = path ? `${path}/${dirHandle.name}` : dirHandle.name;
    
    try {
      for await (const [name, handle] of dirHandle.entries()) {
        const fullPath = `${currentPath}/${name}`;
        
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const fileInfo = {
            id: this.generateFileId(),
            name: file.name,
            type: file.type,
            size: file.size,
            path: fullPath,
            lastModified: file.lastModified,
            handle: handle,
            isImage: file.type.startsWith('image/'),
            isVideo: file.type.startsWith('video/'),
            isAudio: file.type.startsWith('audio/'),
            isDocument: this.isDocument(file.type),
            thumbnail: null
          };
          
          // Generate thumbnail for images
          if (fileInfo.isImage && file.size < 10 * 1024 * 1024) { // Only for images < 10MB
            fileInfo.thumbnail = await this.generateThumbnail(file);
          }
          
          files.push(fileInfo);
          this.localFiles.set(fileInfo.id, fileInfo);
        } else if (handle.kind === 'directory') {
          // Recursively scan subdirectories (with depth limit)
          if (path.split('/').length < 3) { // Max 3 levels deep
            const subFiles = await this.scanDirectory(handle, currentPath);
            files.push(...subFiles);
          }
        }
      }
      
      console.log(`📁 Scanned ${files.length} files from ${dirHandle.name}`);
      return files;
    } catch (error) {
      console.error('❌ Error scanning directory:', error);
      return [];
    }
  }

  // Request access to specific media types
  async requestMediaAccess() {
    const fileTypes = [
      {
        description: 'Images',
        accept: {
          'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
        }
      },
      {
        description: 'Videos',
        accept: {
          'video/*': ['.mp4', '.webm', '.ogg', '.mov', '.avi']
        }
      },
      {
        description: 'Audio',
        accept: {
          'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.flac']
        }
      }
    ];

    try {
      const fileHandles = await window.showOpenFilePicker({
        multiple: true,
        types: fileTypes
      });

      const files = [];
      for (const handle of fileHandles) {
        const file = await handle.getFile();
        const fileInfo = {
          id: this.generateFileId(),
          name: file.name,
          type: file.type,
          size: file.size,
          path: file.name,
          lastModified: file.lastModified,
          handle: handle,
          isImage: file.type.startsWith('image/'),
          isVideo: file.type.startsWith('video/'),
          isAudio: file.type.startsWith('audio/'),
          isDocument: this.isDocument(file.type),
          thumbnail: null
        };

        if (fileInfo.isImage && file.size < 10 * 1024 * 1024) {
          fileInfo.thumbnail = await this.generateThumbnail(file);
        }

        files.push(fileInfo);
        this.localFiles.set(fileInfo.id, fileInfo);
      }

      console.log(`📁 Selected ${files.length} files`);
      return files;
    } catch (error) {
      console.error('❌ Media access error:', error);
      throw error;
    }
  }

  // Generate thumbnail for images
  async generateThumbnail(file, maxSize = 150) {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        // Calculate thumbnail dimensions
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        resolve(thumbnail);
      };
      
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  // Check if file is a document
  isDocument(mimeType) {
    const documentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    ];
    return documentTypes.includes(mimeType);
  }

  // Share file list with connected peer
  async shareFileList() {
    if (!this.peer || !this.peer.connected) {
      console.warn('⚠️ No peer connected for file sharing');
      return;
    }

    const fileList = Array.from(this.localFiles.values()).map(file => ({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      path: file.path,
      lastModified: file.lastModified,
      isImage: file.isImage,
      isVideo: file.isVideo,
      isAudio: file.isAudio,
      isDocument: file.isDocument,
      thumbnail: file.thumbnail
    }));

    const message = {
      type: 'file-list-share',
      files: fileList,
      timestamp: Date.now()
    };

    this.peer.send(JSON.stringify(message));
    console.log(`📤 Shared file list with ${fileList.length} files`);
  }

  // Handle incoming messages
  handleMessage(message) {
    switch (message.type) {
      case 'file-list-share':
        this.handleFileListReceived(message.files);
        break;
      case 'file-request':
        this.handleFileRequest(message.fileId);
        break;
      case 'file-preview-request':
        this.handlePreviewRequest(message.fileId);
        break;
    }
  }

  // Handle received file list from peer
  handleFileListReceived(files) {
    console.log(`📥 Received file list with ${files.length} files`);
    
    this.remoteFiles.clear();
    files.forEach(file => {
      this.remoteFiles.set(file.id, file);
    });

    if (this.onFileListUpdate) {
      this.onFileListUpdate({
        local: Array.from(this.localFiles.values()),
        remote: Array.from(this.remoteFiles.values())
      });
    }
  }

  // Request specific file from peer
  async requestFile(fileId) {
    if (!this.peer || !this.peer.connected) {
      console.warn('⚠️ No peer connected');
      return;
    }

    const message = {
      type: 'file-request',
      fileId: fileId,
      timestamp: Date.now()
    };

    this.peer.send(JSON.stringify(message));
    console.log(`📤 Requested file: ${fileId}`);
  }

  // Handle file request from peer
  async handleFileRequest(fileId) {
    const fileInfo = this.localFiles.get(fileId);
    if (!fileInfo) {
      console.warn(`⚠️ Requested file not found: ${fileId}`);
      return;
    }

    try {
      const file = await fileInfo.handle.getFile();
      console.log(`📤 Sending requested file: ${file.name}`);
      
      // Use existing file transfer system
      if (this.onFileTransfer) {
        this.onFileTransfer(file);
      }
    } catch (error) {
      console.error('❌ Error accessing requested file:', error);
    }
  }

  // Request file preview
  async requestPreview(fileId) {
    if (!this.peer || !this.peer.connected) {
      console.warn('⚠️ No peer connected');
      return;
    }

    const message = {
      type: 'file-preview-request',
      fileId: fileId,
      timestamp: Date.now()
    };

    this.peer.send(JSON.stringify(message));
    console.log(`📤 Requested preview: ${fileId}`);
  }

  // Handle preview request
  async handlePreviewRequest(fileId) {
    const fileInfo = this.localFiles.get(fileId);
    if (!fileInfo) return;

    try {
      const file = await fileInfo.handle.getFile();
      let previewData = null;

      if (fileInfo.isImage && file.size < 5 * 1024 * 1024) { // 5MB limit for preview
        previewData = await this.generateThumbnail(file, 300);
      } else if (fileInfo.isAudio || fileInfo.isVideo) {
        previewData = fileInfo.thumbnail || await this.generateThumbnail(file, 300);
      }

      if (previewData) {
        const message = {
          type: 'file-preview-response',
          fileId: fileId,
          previewData: previewData,
          timestamp: Date.now()
        };

        this.peer.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('❌ Error generating preview:', error);
    }
  }

  // Get local files by category
  getFilesByCategory(category) {
    const files = Array.from(this.localFiles.values());
    
    switch (category) {
      case 'images':
        return files.filter(f => f.isImage);
      case 'videos':
        return files.filter(f => f.isVideo);
      case 'audio':
        return files.filter(f => f.isAudio);
      case 'documents':
        return files.filter(f => f.isDocument);
      default:
        return files;
    }
  }

  // Get remote files by category
  getRemoteFilesByCategory(category) {
    const files = Array.from(this.remoteFiles.values());
    
    switch (category) {
      case 'images':
        return files.filter(f => f.isImage);
      case 'videos':
        return files.filter(f => f.isVideo);
      case 'audio':
        return files.filter(f => f.isAudio);
      case 'documents':
        return files.filter(f => f.isDocument);
      default:
        return files;
    }
  }

  // Utility functions
  generateFileId() {
    return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  // Cleanup
  destroy() {
    this.localFiles.clear();
    this.remoteFiles.clear();
    this.sharedDirectories = [];
    this.onFileListUpdate = null;
    this.onFilePreview = null;
    this.onFileTransfer = null;
  }
}

export default FileBrowser;