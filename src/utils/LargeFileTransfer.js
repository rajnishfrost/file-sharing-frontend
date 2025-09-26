// Large File Transfer with Streaming and Backpressure Control
class LargeFileTransfer {
  constructor(peer) {
    this.peer = peer;
    this.isTransferring = false;
    this.currentTransfer = null;
    this.receivingTransfer = null;
    this.chunkSize = 16 * 1024; // 16KB chunks (smaller for stability)
    this.maxBufferSize = 64 * 1024; // 64KB max buffer
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    
    // Store original data handler if exists
    this.originalDataHandler = null;
    
    // Don't override data handler here - will be called manually
  }

  // Send large file with streaming and backpressure
  async sendFile(file, onProgress, onComplete, onError) {
    if (this.isTransferring) {
      throw new Error('Transfer already in progress');
    }

    console.log(`🚀 Starting large file transfer: ${file.name} (${this.formatSize(file.size)})`);
    
    this.isTransferring = true;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    try {
      // Send file metadata
      const metadata = {
        type: 'large-file-start',
        id: this.generateTransferId(),
        name: file.name,
        size: file.size,
        fileType: file.type,
        chunkSize: this.chunkSize,
        totalChunks: Math.ceil(file.size / this.chunkSize)
      };

      this.currentTransfer = {
        ...metadata,
        file: file,
        sentChunks: 0,
        offset: 0,
        isPaused: false,
        reader: null
      };

      console.log('📋 Sending metadata:', metadata);
      this.sendMessage(metadata);

      // Start streaming
      await this.streamFile();
      
    } catch (error) {
      console.error('❌ File transfer error:', error);
      this.isTransferring = false;
      if (onError) onError(error);
    }
  }

  // Stream file in chunks with backpressure control
  async streamFile() {
    const { file, chunkSize } = this.currentTransfer;
    
    while (this.currentTransfer.offset < file.size && !this.currentTransfer.isPaused) {
      // Check WebRTC buffer status
      if (this.peer.bufferAmount > this.maxBufferSize) {
        console.log('⏸️ Buffer full, waiting...');
        await this.waitForBuffer();
        continue;
      }

      // Read next chunk
      const chunk = await this.readChunk(file, this.currentTransfer.offset, chunkSize);
      
      if (chunk) {
        // Send chunk with metadata
        const chunkMessage = {
          type: 'large-file-chunk',
          id: this.currentTransfer.id,
          chunkIndex: this.currentTransfer.sentChunks,
          isLastChunk: (this.currentTransfer.offset + chunk.byteLength) >= file.size
        };

        this.sendMessage(chunkMessage);
        this.peer.send(chunk);

        this.currentTransfer.sentChunks++;
        this.currentTransfer.offset += chunk.byteLength;

        // Update progress
        const progress = (this.currentTransfer.offset / file.size) * 100;
        if (this.onProgress) {
          this.onProgress(progress, this.currentTransfer.offset, file.size);
        }

        console.log(`📦 Sent chunk ${this.currentTransfer.sentChunks}/${this.currentTransfer.totalChunks} (${progress.toFixed(1)}%)`);

        // Small delay to prevent overwhelming
        await this.delay(1);
      }
    }

    // Send completion message
    this.sendMessage({
      type: 'large-file-complete',
      id: this.currentTransfer.id
    });

    console.log('✅ File transfer completed!');
    this.isTransferring = false;
    if (this.onComplete) this.onComplete();
  }

  // Read file chunk without loading entire file
  readChunk(file, offset, size) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(offset, offset + size);
      const reader = new FileReader();
      
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      
      reader.readAsArrayBuffer(slice);
    });
  }

  // Wait for WebRTC buffer to clear
  waitForBuffer() {
    return new Promise(resolve => {
      const checkBuffer = () => {
        if (this.peer.bufferAmount < this.maxBufferSize / 2) {
          resolve();
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      checkBuffer();
    });
  }

  // Handle incoming data
  handleData(data) {
    try {
      // Check if it's a message (JSON) or binary data
      if (typeof data === 'string' || this.isJsonMessage(data)) {
        this.handleMessage(data);
      } else {
        this.handleChunkData(data);
      }
    } catch (error) {
      console.error('❌ Error handling data:', error);
    }
  }

  // Check if data is JSON message
  isJsonMessage(data) {
    if (typeof data === 'string') return true;
    
    try {
      const text = new TextDecoder().decode(data);
      return text.startsWith('{') && text.endsWith('}');
    } catch {
      return false;
    }
  }

  // Handle control messages
  handleMessage(data) {
    let message;
    
    if (typeof data === 'string') {
      message = JSON.parse(data);
    } else {
      const text = new TextDecoder().decode(data);
      message = JSON.parse(text);
    }

    console.log('📨 Received message:', message.type);

    switch (message.type) {
      case 'large-file-start':
        this.startReceiving(message);
        break;
      case 'large-file-chunk':
        this.handleChunkMessage(message);
        break;
      case 'large-file-complete':
        this.completeReceiving(message);
        break;
      case 'large-file-pause':
        this.pauseTransfer();
        break;
      case 'large-file-resume':
        this.resumeTransfer();
        break;
    }
  }

  // Start receiving large file
  startReceiving(metadata) {
    console.log(`📥 Starting to receive: ${metadata.name} (${this.formatSize(metadata.size)})`);
    
    this.receivingTransfer = {
      ...metadata,
      chunks: new Map(), // Use Map for O(1) chunk access
      receivedChunks: 0,
      receivedBytes: 0,
      expectedChunkIndex: 0,
      isComplete: false
    };

    // Send acknowledgment
    this.sendMessage({
      type: 'large-file-ack',
      id: metadata.id
    });
  }

  // Handle chunk message metadata
  handleChunkMessage(chunkMsg) {
    if (!this.receivingTransfer || this.receivingTransfer.id !== chunkMsg.id) {
      console.warn('⚠️ Received chunk for unknown transfer');
      return;
    }

    this.receivingTransfer.expectedChunkIndex = chunkMsg.chunkIndex;
    this.receivingTransfer.isLastChunk = chunkMsg.isLastChunk;
  }

  // Handle actual chunk data
  handleChunkData(chunkData) {
    if (!this.receivingTransfer) {
      console.warn('⚠️ Received chunk data but no active transfer');
      return;
    }

    const { expectedChunkIndex } = this.receivingTransfer;
    
    // Store chunk
    this.receivingTransfer.chunks.set(expectedChunkIndex, chunkData);
    this.receivingTransfer.receivedChunks++;
    this.receivingTransfer.receivedBytes += chunkData.byteLength;

    // Update progress
    const progress = (this.receivingTransfer.receivedBytes / this.receivingTransfer.size) * 100;
    console.log(`📦 Received chunk ${expectedChunkIndex + 1}/${this.receivingTransfer.totalChunks} (${progress.toFixed(1)}%)`);

    if (this.onProgress) {
      this.onProgress(progress, this.receivingTransfer.receivedBytes, this.receivingTransfer.size);
    }

    // Check if we have all chunks
    if (this.receivingTransfer.receivedChunks === this.receivingTransfer.totalChunks) {
      this.assembleFile();
    }
  }

  // Assemble received chunks into file
  assembleFile() {
    console.log('🔧 Assembling file from chunks...');
    
    const { chunks, totalChunks, name, fileType, size } = this.receivingTransfer;
    const orderedChunks = [];

    // Get chunks in order
    for (let i = 0; i < totalChunks; i++) {
      if (chunks.has(i)) {
        orderedChunks.push(chunks.get(i));
      } else {
        console.error(`❌ Missing chunk ${i}`);
        return;
      }
    }

    // Create blob using stream-like approach for memory efficiency
    const blob = new Blob(orderedChunks, { type: fileType });
    
    if (blob.size !== size) {
      console.error(`❌ Size mismatch: expected ${size}, got ${blob.size}`);
      return;
    }

    const url = URL.createObjectURL(blob);
    const fileInfo = {
      id: Date.now(),
      name: name,
      size: size,
      type: fileType,
      url: url,
      timestamp: new Date().toISOString()
    };

    console.log('✅ File assembled successfully!');
    
    // Clear chunks from memory
    this.receivingTransfer.chunks.clear();
    this.receivingTransfer = null;

    if (this.onComplete) {
      this.onComplete(fileInfo);
    }
  }

  // Complete receiving
  completeReceiving(message) {
    console.log('📨 Transfer completion confirmed');
  }

  // Pause transfer
  pauseTransfer() {
    if (this.currentTransfer) {
      this.currentTransfer.isPaused = true;
      console.log('⏸️ Transfer paused');
    }
  }

  // Resume transfer
  resumeTransfer() {
    if (this.currentTransfer) {
      this.currentTransfer.isPaused = false;
      console.log('▶️ Transfer resumed');
      this.streamFile(); // Continue streaming
    }
  }

  // Send JSON message
  sendMessage(message) {
    this.peer.send(JSON.stringify(message));
  }

  // Generate unique transfer ID
  generateTransferId() {
    return 'transfer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Format file size
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

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup
  destroy() {
    this.isTransferring = false;
    this.currentTransfer = null;
    this.receivingTransfer = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }
}

export default LargeFileTransfer;