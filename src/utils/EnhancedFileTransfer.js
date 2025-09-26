// Enhanced File Transfer System for 100GB+ Files
// Features: Streaming, chunking, resume, multi-file, compression, parallel transfers

class EnhancedFileTransfer {
  constructor(peer, options = {}) {
    this.peer = peer;
    
    // Configuration
    this.config = {
      chunkSize: options.chunkSize || 256 * 1024, // 256KB chunks (optimized for WebRTC)
      parallelStreams: options.parallelStreams || 4, // Number of parallel data channels
      maxBufferSize: options.maxBufferSize || 1024 * 1024, // 1MB buffer
      compressionThreshold: options.compressionThreshold || 1024 * 1024, // Compress files > 1MB
      resumeEnabled: options.resumeEnabled !== false,
      checksumEnabled: options.checksumEnabled !== false,
      adaptiveBitrate: options.adaptiveBitrate !== false
    };

    // State management
    this.transfers = new Map(); // Active transfers
    this.queue = []; // Transfer queue
    this.channels = new Map(); // Data channels for parallel transfer
    this.metrics = {
      bytesTransferred: 0,
      transferSpeed: 0,
      startTime: null,
      samples: [] // Speed samples for adaptive bitrate
    };

    // Callbacks
    this.callbacks = {
      onProgress: null,
      onComplete: null,
      onError: null,
      onSpeed: null,
      onQueued: null
    };

    // Resume data stored in localStorage
    this.resumeData = this.loadResumeData();

    // Initialize performance monitoring
    this.initMetrics();
  }

  // Initialize multiple data channels for parallel transfer
  async initializeChannels() {
    const channels = [];
    
    for (let i = 0; i < this.config.parallelStreams; i++) {
      const channel = this.peer.createDataChannel(`file-transfer-${i}`, {
        ordered: true,
        maxRetransmits: 3
      });
      
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = this.config.maxBufferSize / 2;
      
      channels.push(new Promise((resolve) => {
        channel.onopen = () => {
          console.log(`📡 Channel ${i} opened`);
          this.channels.set(i, channel);
          resolve(channel);
        };
      }));
    }
    
    await Promise.all(channels);
    console.log(`✅ Initialized ${this.config.parallelStreams} parallel channels`);
  }

  // Send single or multiple files
  async sendFiles(files, options = {}) {
    if (!Array.isArray(files)) {
      files = [files];
    }

    const transferId = this.generateTransferId();
    const manifest = this.createManifest(files, transferId);
    
    // Check for resume data
    const resumeInfo = this.checkResumeCapability(manifest);
    if (resumeInfo) {
      manifest.resumeFrom = resumeInfo;
    }

    // Initialize transfer
    const transfer = {
      id: transferId,
      manifest: manifest,
      files: files,
      status: 'preparing',
      progress: 0,
      speed: 0,
      bytesTransferred: 0,
      startTime: Date.now(),
      chunks: new Map(),
      workers: [],
      isPaused: false,
      errors: [],
      ...options
    };

    this.transfers.set(transferId, transfer);

    try {
      // Initialize channels if not already done
      if (this.channels.size === 0) {
        await this.initializeChannels();
      }

      // Send manifest
      await this.sendManifest(manifest);

      // Start transfer
      transfer.status = 'transferring';
      await this.processTransfer(transfer);

    } catch (error) {
      console.error('❌ Transfer failed:', error);
      transfer.status = 'failed';
      transfer.errors.push(error);
      this.handleError(transfer, error);
    }

    return transferId;
  }

  // Create manifest for file transfer
  createManifest(files, transferId) {
    const manifest = {
      id: transferId,
      type: 'transfer-manifest',
      version: '2.0',
      timestamp: Date.now(),
      files: [],
      totalSize: 0,
      chunkSize: this.config.chunkSize,
      parallelStreams: this.config.parallelStreams,
      features: {
        compression: this.config.compressionThreshold > 0,
        checksum: this.config.checksumEnabled,
        resume: this.config.resumeEnabled
      }
    };

    for (const file of files) {
      const fileInfo = {
        id: this.generateFileId(),
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
        path: file.webkitRelativePath || file.name,
        chunks: Math.ceil(file.size / this.config.chunkSize),
        checksum: null // Will be calculated if enabled
      };

      manifest.files.push(fileInfo);
      manifest.totalSize += file.size;
    }

    return manifest;
  }

  // Process file transfer with parallel streaming
  async processTransfer(transfer) {
    const { files, manifest } = transfer;
    
    // Create worker pool for parallel processing
    const workerCount = Math.min(this.config.parallelStreams, files.length);
    const fileQueue = [...files];
    const workers = [];

    for (let i = 0; i < workerCount; i++) {
      workers.push(this.createWorker(i, transfer, fileQueue));
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    // Send completion signal
    this.sendMessage({
      type: 'transfer-complete',
      id: transfer.id,
      manifest: manifest
    });

    transfer.status = 'completed';
    this.saveResumeData(transfer);
    
    if (this.callbacks.onComplete) {
      this.callbacks.onComplete(transfer);
    }
  }

  // Create worker for parallel file processing
  async createWorker(workerId, transfer, fileQueue) {
    const channel = this.channels.get(workerId);
    
    while (fileQueue.length > 0 && !transfer.isPaused) {
      const file = fileQueue.shift();
      if (!file) break;

      await this.streamFile(file, channel, transfer, workerId);
    }
  }

  // Stream individual file with adaptive chunking
  async streamFile(file, channel, transfer, workerId) {
    console.log(`👷 Worker ${workerId} processing: ${file.name}`);
    
    const fileId = this.generateFileId();
    const totalChunks = Math.ceil(file.size / this.config.chunkSize);
    let chunkIndex = 0;
    let offset = 0;

    // Check for resume point
    const resumePoint = this.getResumePoint(transfer.id, file.name);
    if (resumePoint) {
      offset = resumePoint.offset;
      chunkIndex = resumePoint.chunkIndex;
      console.log(`📥 Resuming from chunk ${chunkIndex}/${totalChunks}`);
    }

    // Send file header
    this.sendMessage({
      type: 'file-header',
      transferId: transfer.id,
      fileId: fileId,
      workerId: workerId,
      name: file.name,
      size: file.size,
      totalChunks: totalChunks,
      resumeFrom: chunkIndex
    });

    // Stream chunks
    while (offset < file.size && !transfer.isPaused) {
      // Adaptive chunk size based on network conditions
      const chunkSize = this.getAdaptiveChunkSize();
      
      // Check buffer pressure
      if (channel.bufferedAmount > this.config.maxBufferSize) {
        await this.waitForBuffer(channel);
      }

      // Read chunk
      const chunk = await this.readChunk(file, offset, chunkSize);
      
      // Optionally compress chunk
      const processedChunk = await this.processChunk(chunk, file);
      
      // Create chunk metadata
      const chunkMeta = {
        type: 'file-chunk',
        transferId: transfer.id,
        fileId: fileId,
        workerId: workerId,
        index: chunkIndex,
        offset: offset,
        size: processedChunk.byteLength,
        compressed: processedChunk.compressed || false,
        checksum: this.config.checksumEnabled ? await this.calculateChecksum(processedChunk) : null
      };

      // Send metadata then chunk
      this.sendMessage(chunkMeta);
      channel.send(processedChunk);

      // Update progress
      offset += chunk.byteLength;
      chunkIndex++;
      transfer.bytesTransferred += chunk.byteLength;
      
      this.updateProgress(transfer);
      this.updateMetrics(chunk.byteLength);

      // Save resume point periodically
      if (chunkIndex % 100 === 0) {
        this.saveResumePoint(transfer.id, file.name, offset, chunkIndex);
      }
    }

    // Send file completion
    this.sendMessage({
      type: 'file-complete',
      transferId: transfer.id,
      fileId: fileId,
      name: file.name,
      checksum: this.config.checksumEnabled ? await this.calculateFileChecksum(file) : null
    });
  }

  // Read file chunk efficiently
  readChunk(file, offset, size) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(offset, Math.min(offset + size, file.size));
      const reader = new FileReader();
      
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      
      reader.readAsArrayBuffer(slice);
    });
  }

  // Process chunk (compression, encryption, etc.)
  async processChunk(chunk, file) {
    // Skip compression for already compressed formats
    const compressedTypes = ['image/jpeg', 'image/png', 'video/mp4', 'application/zip'];
    if (compressedTypes.includes(file.type)) {
      return chunk;
    }

    // Compress if chunk is large enough
    if (chunk.byteLength > this.config.compressionThreshold) {
      try {
        const compressed = await this.compressData(chunk);
        if (compressed.byteLength < chunk.byteLength * 0.9) {
          compressed.compressed = true;
          return compressed;
        }
      } catch (error) {
        console.warn('Compression failed, sending uncompressed:', error);
      }
    }

    return chunk;
  }

  // Compress data using CompressionStream API
  async compressData(data) {
    if (!window.CompressionStream) {
      return data; // Fallback if not supported
    }

    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();

    const chunks = [];
    const reader = cs.readable.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return new Blob(chunks).arrayBuffer();
  }

  // Calculate checksum for integrity
  async calculateChecksum(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
  }

  // Calculate full file checksum
  async calculateFileChecksum(file) {
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for checksum
    let offset = 0;
    const chunks = [];

    while (offset < file.size) {
      const chunk = await this.readChunk(file, offset, CHUNK_SIZE);
      chunks.push(new Uint8Array(chunk));
      offset += chunk.byteLength;
    }

    const combined = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
    let position = 0;
    for (const chunk of chunks) {
      combined.set(chunk, position);
      position += chunk.length;
    }

    return this.calculateChecksum(combined.buffer);
  }

  // Adaptive chunk size based on network speed
  getAdaptiveChunkSize() {
    if (!this.config.adaptiveBitrate) {
      return this.config.chunkSize;
    }

    const avgSpeed = this.getAverageSpeed();
    
    if (avgSpeed > 10 * 1024 * 1024) { // > 10 MB/s
      return 512 * 1024; // 512KB chunks
    } else if (avgSpeed > 1 * 1024 * 1024) { // > 1 MB/s
      return 256 * 1024; // 256KB chunks
    } else if (avgSpeed > 100 * 1024) { // > 100 KB/s
      return 64 * 1024; // 64KB chunks
    } else {
      return 16 * 1024; // 16KB chunks for slow connections
    }
  }

  // Wait for buffer to clear
  waitForBuffer(channel) {
    return new Promise(resolve => {
      const checkBuffer = () => {
        if (channel.bufferedAmount < this.config.maxBufferSize / 2) {
          resolve();
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      checkBuffer();
    });
  }

  // Update transfer progress
  updateProgress(transfer) {
    transfer.progress = (transfer.bytesTransferred / transfer.manifest.totalSize) * 100;
    
    if (this.callbacks.onProgress) {
      this.callbacks.onProgress({
        transferId: transfer.id,
        progress: transfer.progress,
        bytesTransferred: transfer.bytesTransferred,
        totalBytes: transfer.manifest.totalSize,
        speed: this.metrics.transferSpeed,
        remainingTime: this.estimateRemainingTime(transfer)
      });
    }
  }

  // Update transfer metrics
  updateMetrics(bytes) {
    this.metrics.bytesTransferred += bytes;
    
    const now = Date.now();
    if (!this.metrics.startTime) {
      this.metrics.startTime = now;
    }

    const elapsed = (now - this.metrics.startTime) / 1000;
    if (elapsed > 0) {
      const currentSpeed = bytes / elapsed;
      this.metrics.samples.push(currentSpeed);
      
      // Keep last 10 samples
      if (this.metrics.samples.length > 10) {
        this.metrics.samples.shift();
      }

      this.metrics.transferSpeed = this.getAverageSpeed();
      
      if (this.callbacks.onSpeed) {
        this.callbacks.onSpeed(this.metrics.transferSpeed);
      }
    }
  }

  // Get average transfer speed
  getAverageSpeed() {
    if (this.metrics.samples.length === 0) return 0;
    const sum = this.metrics.samples.reduce((a, b) => a + b, 0);
    return sum / this.metrics.samples.length;
  }

  // Estimate remaining time
  estimateRemainingTime(transfer) {
    if (this.metrics.transferSpeed === 0) return Infinity;
    
    const remainingBytes = transfer.manifest.totalSize - transfer.bytesTransferred;
    return remainingBytes / this.metrics.transferSpeed;
  }

  // Resume capability
  saveResumePoint(transferId, fileName, offset, chunkIndex) {
    const resumeData = this.loadResumeData();
    
    if (!resumeData[transferId]) {
      resumeData[transferId] = {};
    }

    resumeData[transferId][fileName] = {
      offset: offset,
      chunkIndex: chunkIndex,
      timestamp: Date.now()
    };

    localStorage.setItem('file-transfer-resume', JSON.stringify(resumeData));
  }

  getResumePoint(transferId, fileName) {
    const resumeData = this.loadResumeData();
    return resumeData[transferId]?.[fileName];
  }

  loadResumeData() {
    try {
      const data = localStorage.getItem('file-transfer-resume');
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  saveResumeData(transfer) {
    const resumeData = this.loadResumeData();
    
    // Clean up completed transfers
    if (transfer.status === 'completed') {
      delete resumeData[transfer.id];
    }

    // Clean up old resume data (older than 7 days)
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const [id, files] of Object.entries(resumeData)) {
      for (const [fileName, data] of Object.entries(files)) {
        if (data.timestamp < weekAgo) {
          delete files[fileName];
        }
      }
      if (Object.keys(files).length === 0) {
        delete resumeData[id];
      }
    }

    localStorage.setItem('file-transfer-resume', JSON.stringify(resumeData));
  }

  checkResumeCapability(manifest) {
    const resumeData = this.loadResumeData();
    const resumeInfo = {};

    for (const file of manifest.files) {
      const existingData = Object.values(resumeData).find(
        transfer => transfer[file.name]
      );
      
      if (existingData && existingData[file.name]) {
        resumeInfo[file.name] = existingData[file.name];
      }
    }

    return Object.keys(resumeInfo).length > 0 ? resumeInfo : null;
  }

  // Handle incoming transfers
  async handleIncomingTransfer(data) {
    // This would be implemented on the receiving end
    // Similar structure but for receiving and assembling files
  }

  // Pause/Resume controls
  pauseTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.isPaused = true;
      this.sendMessage({
        type: 'transfer-pause',
        id: transferId
      });
    }
  }

  resumeTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer && transfer.isPaused) {
      transfer.isPaused = false;
      this.processTransfer(transfer);
    }
  }

  // Cancel transfer
  cancelTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.status = 'cancelled';
      transfer.isPaused = true;
      
      this.sendMessage({
        type: 'transfer-cancel',
        id: transferId
      });

      this.transfers.delete(transferId);
    }
  }

  // Send control message
  sendMessage(message) {
    if (this.peer && this.peer.connected) {
      this.peer.send(JSON.stringify(message));
    }
  }

  // Initialize metrics
  initMetrics() {
    setInterval(() => {
      if (this.metrics.samples.length > 0) {
        // Update speed calculation
        this.metrics.transferSpeed = this.getAverageSpeed();
      }
    }, 1000);
  }

  // Error handling
  handleError(transfer, error) {
    console.error(`Transfer ${transfer.id} error:`, error);
    
    if (this.callbacks.onError) {
      this.callbacks.onError({
        transferId: transfer.id,
        error: error,
        canResume: this.config.resumeEnabled
      });
    }
  }

  // Utility functions
  generateTransferId() {
    return `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

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

  formatTime(seconds) {
    if (seconds === Infinity) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  // Cleanup
  destroy() {
    // Close all channels
    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();

    // Clear transfers
    this.transfers.clear();
    
    // Reset metrics
    this.metrics = {
      bytesTransferred: 0,
      transferSpeed: 0,
      startTime: null,
      samples: []
    };
  }
}

export default EnhancedFileTransfer;