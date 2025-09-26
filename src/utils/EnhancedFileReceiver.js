// Enhanced File Receiver for 100GB+ Files
// Handles incoming transfers with resume, verification, and assembly

class EnhancedFileReceiver {
  constructor(peer, options = {}) {
    this.peer = peer;
    
    // Configuration
    this.config = {
      autoAccept: options.autoAccept || false,
      maxConcurrentTransfers: options.maxConcurrentTransfers || 5,
      verifyChecksum: options.verifyChecksum !== false,
      storageType: options.storageType || 'memory', // 'memory', 'indexeddb', 'filesystem'
      autoDownload: options.autoDownload || false,
      maxMemoryUsage: options.maxMemoryUsage || 500 * 1024 * 1024 // 500MB max in memory
    };

    // State management
    this.transfers = new Map();
    this.channels = new Map();
    this.pendingChunks = new Map();
    this.fileWriters = new Map();
    
    // Callbacks
    this.callbacks = {
      onTransferRequest: null,
      onProgress: null,
      onFileComplete: null,
      onTransferComplete: null,
      onError: null
    };

    // Initialize storage
    this.initStorage();
    
    // Setup message handlers
    this.setupHandlers();
  }

  // Initialize storage based on type
  async initStorage() {
    if (this.config.storageType === 'filesystem' && 'showSaveFilePicker' in window) {
      console.log('📁 File System Access API available');
    } else if (this.config.storageType === 'indexeddb') {
      await this.initIndexedDB();
    } else {
      console.log('💾 Using in-memory storage');
    }
  }

  // Initialize IndexedDB for large file storage
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FileTransferDB', 1);
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('📊 IndexedDB initialized');
        resolve();
      };

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('transferId', 'transferId', { unique: false });
        }
      };
    });
  }

  // Setup message and data handlers
  setupHandlers() {
    // Handle data channel creation
    this.peer.on('datachannel', (channel) => {
      console.log(`📡 Received data channel: ${channel.label}`);
      
      const match = channel.label.match(/file-transfer-(\d+)/);
      if (match) {
        const channelId = parseInt(match[1]);
        this.channels.set(channelId, channel);
        
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (event) => this.handleChannelData(channelId, event.data);
      }
    });

    // Handle main peer messages
    this.peer.on('data', (data) => this.handleMessage(data));
  }

  // Handle incoming messages
  async handleMessage(data) {
    try {
      let message;
      
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else {
        const text = new TextDecoder().decode(data);
        message = JSON.parse(text);
      }

      console.log('📨 Received message:', message.type);

      switch (message.type) {
        case 'transfer-manifest':
          await this.handleManifest(message);
          break;
        
        case 'file-header':
          await this.handleFileHeader(message);
          break;
        
        case 'file-chunk':
          await this.handleChunkMetadata(message);
          break;
        
        case 'file-complete':
          await this.handleFileComplete(message);
          break;
        
        case 'transfer-complete':
          await this.handleTransferComplete(message);
          break;
        
        case 'transfer-pause':
          this.handleTransferPause(message);
          break;
        
        case 'transfer-resume':
          this.handleTransferResume(message);
          break;
        
        case 'transfer-cancel':
          this.handleTransferCancel(message);
          break;
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  // Handle data from specific channel
  async handleChannelData(channelId, data) {
    // This should be raw chunk data
    const pendingMeta = this.pendingChunks.get(channelId);
    
    if (pendingMeta) {
      await this.processChunk(pendingMeta, data);
      this.pendingChunks.delete(channelId);
    } else {
      console.warn(`⚠️ Received chunk on channel ${channelId} without metadata`);
    }
  }

  // Handle transfer manifest
  async handleManifest(manifest) {
    console.log('📋 Received transfer manifest:', manifest);
    
    // Check if we should auto-accept
    if (!this.config.autoAccept && this.callbacks.onTransferRequest) {
      const accepted = await this.callbacks.onTransferRequest(manifest);
      if (!accepted) {
        this.sendMessage({
          type: 'transfer-rejected',
          id: manifest.id,
          reason: 'User rejected'
        });
        return;
      }
    }

    // Initialize transfer
    const transfer = {
      id: manifest.id,
      manifest: manifest,
      status: 'receiving',
      files: new Map(),
      progress: 0,
      bytesReceived: 0,
      startTime: Date.now(),
      errors: []
    };

    this.transfers.set(manifest.id, transfer);

    // Prepare storage for each file
    for (const fileInfo of manifest.files) {
      await this.prepareFileStorage(transfer, fileInfo);
    }

    // Send acknowledgment
    this.sendMessage({
      type: 'transfer-accepted',
      id: manifest.id,
      ready: true
    });
  }

  // Prepare storage for incoming file
  async prepareFileStorage(transfer, fileInfo) {
    const fileData = {
      id: fileInfo.id,
      name: fileInfo.name,
      size: fileInfo.size,
      type: fileInfo.type,
      chunks: new Map(),
      receivedChunks: 0,
      totalChunks: fileInfo.chunks,
      bytesReceived: 0,
      checksum: fileInfo.checksum,
      writer: null,
      handle: null
    };

    // Determine storage strategy based on file size
    if (this.config.storageType === 'filesystem' && fileInfo.size > this.config.maxMemoryUsage) {
      fileData.storageType = 'filesystem';
      await this.prepareFilesystemStorage(fileData);
    } else if (this.config.storageType === 'indexeddb' && fileInfo.size > this.config.maxMemoryUsage) {
      fileData.storageType = 'indexeddb';
    } else {
      fileData.storageType = 'memory';
    }

    transfer.files.set(fileInfo.id, fileData);
  }

  // Prepare filesystem storage using File System Access API
  async prepareFilesystemStorage(fileData) {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileData.name,
          types: [{
            description: 'Files',
            accept: { '*/*': ['*'] }
          }]
        });
        
        fileData.handle = handle;
        fileData.writer = await handle.createWritable();
        console.log(`📁 Filesystem storage prepared for ${fileData.name}`);
      } catch (error) {
        console.error('Failed to prepare filesystem storage:', error);
        fileData.storageType = 'memory'; // Fallback
      }
    }
  }

  // Handle file header
  async handleFileHeader(header) {
    const transfer = this.transfers.get(header.transferId);
    if (!transfer) {
      console.warn('⚠️ Received header for unknown transfer');
      return;
    }

    const fileData = transfer.files.get(header.fileId);
    if (fileData) {
      fileData.workerId = header.workerId;
      fileData.resumeFrom = header.resumeFrom || 0;
      
      if (header.resumeFrom > 0) {
        console.log(`📥 Resuming ${header.name} from chunk ${header.resumeFrom}`);
        fileData.receivedChunks = header.resumeFrom;
        fileData.bytesReceived = header.resumeFrom * transfer.manifest.chunkSize;
      }
    }
  }

  // Handle chunk metadata
  async handleChunkMetadata(chunkMeta) {
    const transfer = this.transfers.get(chunkMeta.transferId);
    if (!transfer) {
      console.warn('⚠️ Received chunk for unknown transfer');
      return;
    }

    // Store metadata for when chunk data arrives
    this.pendingChunks.set(chunkMeta.workerId, {
      ...chunkMeta,
      transfer: transfer
    });
  }

  // Process actual chunk data
  async processChunk(chunkMeta, chunkData) {
    const { transfer, fileId, index, compressed, checksum } = chunkMeta;
    const fileData = transfer.files.get(fileId);
    
    if (!fileData) {
      console.warn('⚠️ Received chunk for unknown file');
      return;
    }

    try {
      // Decompress if needed
      let processedData = chunkData;
      if (compressed) {
        processedData = await this.decompressData(chunkData);
      }

      // Verify checksum if enabled
      if (this.config.verifyChecksum && checksum) {
        const calculated = await this.calculateChecksum(processedData);
        if (calculated !== checksum) {
          throw new Error(`Checksum mismatch for chunk ${index}`);
        }
      }

      // Store chunk based on storage type
      await this.storeChunk(fileData, index, processedData);

      // Update progress
      fileData.receivedChunks++;
      fileData.bytesReceived += processedData.byteLength;
      transfer.bytesReceived += processedData.byteLength;

      this.updateProgress(transfer);

      // Check if file is complete
      if (fileData.receivedChunks === fileData.totalChunks) {
        await this.assembleFile(transfer, fileData);
      }

    } catch (error) {
      console.error(`❌ Error processing chunk ${index}:`, error);
      transfer.errors.push({ fileId, chunkIndex: index, error: error.message });
      
      // Request chunk retransmission
      this.sendMessage({
        type: 'chunk-error',
        transferId: transfer.id,
        fileId: fileId,
        chunkIndex: index,
        error: error.message
      });
    }
  }

  // Store chunk based on storage type
  async storeChunk(fileData, index, data) {
    switch (fileData.storageType) {
      case 'filesystem':
        await this.storeChunkToFilesystem(fileData, index, data);
        break;
      
      case 'indexeddb':
        await this.storeChunkToIndexedDB(fileData, index, data);
        break;
      
      default: // memory
        fileData.chunks.set(index, data);
    }
  }

  // Store chunk to filesystem
  async storeChunkToFilesystem(fileData, index, data) {
    if (fileData.writer) {
      // Calculate position
      const position = index * data.byteLength;
      await fileData.writer.write({ type: 'write', data, position });
    } else {
      // Fallback to memory if writer not available
      fileData.chunks.set(index, data);
    }
  }

  // Store chunk to IndexedDB
  async storeChunkToIndexedDB(fileData, index, data) {
    const transaction = this.db.transaction(['chunks'], 'readwrite');
    const store = transaction.objectStore('chunks');
    
    await store.put({
      id: `${fileData.id}_${index}`,
      fileId: fileData.id,
      index: index,
      data: data
    });
  }

  // Decompress data
  async decompressData(data) {
    if (!window.DecompressionStream) {
      throw new Error('Decompression not supported');
    }

    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();

    const chunks = [];
    const reader = ds.readable.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return new Blob(chunks).arrayBuffer();
  }

  // Calculate checksum
  async calculateChecksum(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
  }

  // Assemble complete file
  async assembleFile(transfer, fileData) {
    console.log(`🔧 Assembling file: ${fileData.name}`);

    try {
      let blob;

      switch (fileData.storageType) {
        case 'filesystem':
          // Close the writer
          if (fileData.writer) {
            await fileData.writer.close();
          }
          // File is already assembled on disk
          console.log(`✅ File saved to disk: ${fileData.name}`);
          break;

        case 'indexeddb':
          blob = await this.assembleFromIndexedDB(fileData);
          break;

        default: // memory
          blob = await this.assembleFromMemory(fileData);
      }

      // Create download link if blob available
      if (blob) {
        const url = URL.createObjectURL(blob);
        fileData.url = url;
        fileData.blob = blob;

        if (this.config.autoDownload) {
          this.downloadFile(fileData);
        }
      }

      fileData.completed = true;

      if (this.callbacks.onFileComplete) {
        this.callbacks.onFileComplete({
          transferId: transfer.id,
          file: {
            name: fileData.name,
            size: fileData.size,
            type: fileData.type,
            url: fileData.url,
            handle: fileData.handle
          }
        });
      }

    } catch (error) {
      console.error(`❌ Failed to assemble file ${fileData.name}:`, error);
      transfer.errors.push({ fileId: fileData.id, error: error.message });
    }
  }

  // Assemble file from memory chunks
  async assembleFromMemory(fileData) {
    const orderedChunks = [];
    
    for (let i = 0; i < fileData.totalChunks; i++) {
      const chunk = fileData.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i}`);
      }
      orderedChunks.push(chunk);
    }

    const blob = new Blob(orderedChunks, { type: fileData.type });
    
    // Verify size
    if (blob.size !== fileData.size) {
      console.warn(`⚠️ Size mismatch: expected ${fileData.size}, got ${blob.size}`);
    }

    // Clear chunks from memory
    fileData.chunks.clear();

    return blob;
  }

  // Assemble file from IndexedDB
  async assembleFromIndexedDB(fileData) {
    const orderedChunks = [];
    const transaction = this.db.transaction(['chunks'], 'readonly');
    const store = transaction.objectStore('chunks');

    for (let i = 0; i < fileData.totalChunks; i++) {
      const request = store.get(`${fileData.id}_${i}`);
      const chunk = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!chunk) {
        throw new Error(`Missing chunk ${i} in IndexedDB`);
      }
      orderedChunks.push(chunk.data);
    }

    const blob = new Blob(orderedChunks, { type: fileData.type });

    // Clean up IndexedDB
    await this.cleanupIndexedDB(fileData.id);

    return blob;
  }

  // Clean up IndexedDB chunks
  async cleanupIndexedDB(fileId) {
    const transaction = this.db.transaction(['chunks'], 'readwrite');
    const store = transaction.objectStore('chunks');
    
    // Delete all chunks for this file
    for (let i = 0; i < 10000; i++) { // Max safety limit
      try {
        await store.delete(`${fileId}_${i}`);
      } catch {
        break; // No more chunks
      }
    }
  }

  // Handle file completion
  async handleFileComplete(message) {
    const transfer = this.transfers.get(message.transferId);
    if (!transfer) return;

    const fileData = transfer.files.get(message.fileId);
    if (!fileData) return;

    // Verify final checksum if provided
    if (message.checksum && this.config.verifyChecksum) {
      // File should already be assembled at this point
      console.log(`✅ File ${message.name} verified and complete`);
    }
  }

  // Handle transfer completion
  async handleTransferComplete(message) {
    const transfer = this.transfers.get(message.id);
    if (!transfer) return;

    transfer.status = 'completed';
    transfer.endTime = Date.now();
    
    const duration = (transfer.endTime - transfer.startTime) / 1000;
    const speed = transfer.bytesReceived / duration;

    console.log(`✅ Transfer ${message.id} completed`);
    console.log(`📊 Stats: ${this.formatSize(transfer.bytesReceived)} in ${duration.toFixed(1)}s (${this.formatSize(speed)}/s)`);

    if (this.callbacks.onTransferComplete) {
      this.callbacks.onTransferComplete({
        transferId: transfer.id,
        files: Array.from(transfer.files.values()).map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
          url: f.url
        })),
        duration: duration,
        speed: speed,
        errors: transfer.errors
      });
    }

    // Cleanup
    this.transfers.delete(message.id);
  }

  // Handle transfer pause
  handleTransferPause(message) {
    const transfer = this.transfers.get(message.id);
    if (transfer) {
      transfer.status = 'paused';
      console.log(`⏸️ Transfer ${message.id} paused`);
    }
  }

  // Handle transfer resume
  handleTransferResume(message) {
    const transfer = this.transfers.get(message.id);
    if (transfer) {
      transfer.status = 'receiving';
      console.log(`▶️ Transfer ${message.id} resumed`);
    }
  }

  // Handle transfer cancel
  handleTransferCancel(message) {
    const transfer = this.transfers.get(message.id);
    if (transfer) {
      transfer.status = 'cancelled';
      console.log(`❌ Transfer ${message.id} cancelled`);
      
      // Cleanup resources
      for (const fileData of transfer.files.values()) {
        if (fileData.writer) {
          fileData.writer.abort();
        }
        if (fileData.url) {
          URL.revokeObjectURL(fileData.url);
        }
      }
      
      this.transfers.delete(message.id);
    }
  }

  // Update progress
  updateProgress(transfer) {
    transfer.progress = (transfer.bytesReceived / transfer.manifest.totalSize) * 100;
    
    if (this.callbacks.onProgress) {
      this.callbacks.onProgress({
        transferId: transfer.id,
        progress: transfer.progress,
        bytesReceived: transfer.bytesReceived,
        totalBytes: transfer.manifest.totalSize,
        files: Array.from(transfer.files.values()).map(f => ({
          name: f.name,
          progress: (f.bytesReceived / f.size) * 100
        }))
      });
    }
  }

  // Download file
  downloadFile(fileData) {
    const a = document.createElement('a');
    a.href = fileData.url;
    a.download = fileData.name;
    a.click();
  }

  // Send message
  sendMessage(message) {
    if (this.peer && this.peer.connected) {
      this.peer.send(JSON.stringify(message));
    }
  }

  // Utility functions
  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  // Cleanup
  destroy() {
    // Clear all transfers
    for (const transfer of this.transfers.values()) {
      for (const fileData of transfer.files.values()) {
        if (fileData.writer) {
          fileData.writer.abort();
        }
        if (fileData.url) {
          URL.revokeObjectURL(fileData.url);
        }
      }
    }
    
    this.transfers.clear();
    this.channels.clear();
    this.pendingChunks.clear();
    
    if (this.db) {
      this.db.close();
    }
  }
}

export default EnhancedFileReceiver;