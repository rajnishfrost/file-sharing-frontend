// Fixed Large File Transfer - Handles backpressure and prevents connection drops
class FixedLargeFileTransfer {
  constructor(peer) {
    this.peer = peer;
    this.transfers = new Map();
    
    // Optimized configuration for stability
    this.config = {
      chunkSize: 16 * 1024, // 16KB chunks - smaller for stability
      maxBufferAmount: 256 * 1024, // 256KB max buffer
      bufferLowWatermark: 64 * 1024, // Resume at 64KB
      ackTimeout: 30000, // 30 seconds for acknowledgment
      keepAliveInterval: 5000, // Send keepalive every 5 seconds
      maxRetries: 3,
      delayBetweenChunks: 10, // ms delay between chunks
    };

    // Callbacks
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onFileReceived = null;

    // Keep alive timer
    this.keepAliveTimer = null;
    
    // Setup message handler
    this.setupMessageHandler();
    
    // Start keepalive
    this.startKeepAlive();
  }

  setupMessageHandler() {
    // Store original handler
    const originalHandler = this.peer.ondata;
    
    // Override data handler
    this.peer.on('data', (data) => {
      try {
        // Check if it's our protocol
        if (this.isTransferProtocol(data)) {
          this.handleIncomingData(data);
        } else if (originalHandler) {
          // Pass through to original handler
          originalHandler(data);
        }
      } catch (error) {
        console.error('Error handling data:', error);
      }
    });
  }

  isTransferProtocol(data) {
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return parsed.protocol === 'fixed-transfer';
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        // Check if this is a chunk we're expecting
        return this.isExpectedChunk(data);
      }
    } catch {
      return false;
    }
    return false;
  }

  isExpectedChunk(data) {
    // Check if we have any active receiving transfers
    for (const transfer of this.transfers.values()) {
      if (transfer.type === 'receive' && transfer.expectingChunk) {
        return true;
      }
    }
    return false;
  }

  startKeepAlive() {
    this.keepAliveTimer = setInterval(() => {
      if (this.peer && this.peer.connected) {
        this.sendControlMessage({
          type: 'keepalive',
          timestamp: Date.now()
        });
      }
    }, this.config.keepAliveInterval);
  }

  async sendFile(file, onProgress, onComplete, onError) {
    const transferId = this.generateTransferId();
    
    console.log(`📤 Starting transfer: ${file.name} (${this.formatSize(file.size)})`);
    
    // Create transfer object
    const transfer = {
      id: transferId,
      type: 'send',
      file: file,
      totalChunks: Math.ceil(file.size / this.config.chunkSize),
      sentChunks: 0,
      offset: 0,
      isPaused: false,
      startTime: Date.now(),
      acks: new Set(),
      retries: 0
    };

    this.transfers.set(transferId, transfer);
    
    // Store callbacks
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    try {
      // Send metadata first
      await this.sendMetadata(transfer);
      
      // Wait for acknowledgment
      await this.waitForAck(transferId, 'metadata');
      
      // Start streaming
      await this.streamFile(transfer);
      
    } catch (error) {
      console.error('Transfer failed:', error);
      this.transfers.delete(transferId);
      if (onError) onError(error);
    }
  }

  async sendMetadata(transfer) {
    const metadata = {
      protocol: 'fixed-transfer',
      type: 'metadata',
      id: transfer.id,
      name: transfer.file.name,
      size: transfer.file.size,
      mimeType: transfer.file.type || 'application/octet-stream',
      totalChunks: transfer.totalChunks,
      chunkSize: this.config.chunkSize
    };

    console.log('📋 Sending metadata:', metadata);
    this.sendControlMessage(metadata);
  }

  async streamFile(transfer) {
    while (transfer.offset < transfer.file.size && !transfer.isPaused) {
      try {
        // Check buffer pressure
        await this.checkBufferPressure();
        
        // Read chunk
        const chunk = await this.readChunk(
          transfer.file,
          transfer.offset,
          this.config.chunkSize
        );

        // Send chunk header
        const chunkHeader = {
          protocol: 'fixed-transfer',
          type: 'chunk-header',
          id: transfer.id,
          chunkIndex: transfer.sentChunks,
          chunkSize: chunk.byteLength,
          offset: transfer.offset,
          isLast: (transfer.offset + chunk.byteLength) >= transfer.file.size
        };

        this.sendControlMessage(chunkHeader);
        
        // Wait a bit for header to process
        await this.delay(5);
        
        // Send actual chunk data
        await this.sendChunkData(chunk);
        
        // Update progress
        transfer.sentChunks++;
        transfer.offset += chunk.byteLength;
        
        const progress = (transfer.offset / transfer.file.size) * 100;
        if (this.onProgress) {
          this.onProgress(progress, transfer.offset, transfer.file.size);
        }

        console.log(`📦 Sent chunk ${transfer.sentChunks}/${transfer.totalChunks} (${progress.toFixed(1)}%)`);
        
        // Add delay between chunks to prevent overwhelming
        await this.delay(this.config.delayBetweenChunks);
        
        // Every 10 chunks, wait for acknowledgment
        if (transfer.sentChunks % 10 === 0) {
          try {
            await this.waitForAck(transfer.id, `chunk-${transfer.sentChunks}`, 5000);
          } catch (e) {
            console.warn('No ack received for chunk batch, continuing...');
          }
        }
        
      } catch (error) {
        console.error('Error sending chunk:', error);
        transfer.retries++;
        
        if (transfer.retries >= this.config.maxRetries) {
          throw new Error('Max retries exceeded');
        }
        
        // Wait before retry
        await this.delay(1000);
      }
    }

    // Send completion message
    this.sendControlMessage({
      protocol: 'fixed-transfer',
      type: 'transfer-complete',
      id: transfer.id
    });

    console.log('✅ File transfer completed');
    this.transfers.delete(transfer.id);
    
    if (this.onComplete) {
      this.onComplete();
    }
  }

  async checkBufferPressure() {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.peer || !this.peer.connected) {
          throw new Error('Peer disconnected');
        }
        
        const bufferAmount = this.peer.bufferedAmount || 0;
        
        if (bufferAmount > this.config.maxBufferAmount) {
          console.log(`⏸️ Buffer pressure: ${bufferAmount} bytes, waiting...`);
          setTimeout(check, 50);
        } else {
          resolve();
        }
      };
      check();
    });
  }

  async sendChunkData(chunk) {
    // Split large chunks into smaller pieces if needed
    const maxPieceSize = 16 * 1024; // 16KB pieces
    
    if (chunk.byteLength <= maxPieceSize) {
      this.peer.send(chunk);
    } else {
      // Send in smaller pieces
      let offset = 0;
      while (offset < chunk.byteLength) {
        const piece = chunk.slice(offset, offset + maxPieceSize);
        await this.checkBufferPressure();
        this.peer.send(piece);
        offset += piece.byteLength;
        await this.delay(5);
      }
    }
  }

  readChunk(file, offset, size) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(offset, Math.min(offset + size, file.size));
      const reader = new FileReader();
      
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      
      reader.readAsArrayBuffer(slice);
    });
  }

  waitForAck(transferId, type, timeout = this.config.ackTimeout) {
    return new Promise((resolve, reject) => {
      const ackKey = `${transferId}-${type}`;
      let timeoutId;

      const handleAck = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      // Store ack handler
      this.transfers.get(transferId).acks.set(ackKey, handleAck);

      timeoutId = setTimeout(() => {
        const transfer = this.transfers.get(transferId);
        if (transfer) {
          transfer.acks.delete(ackKey);
        }
        reject(new Error(`Acknowledgment timeout for ${type}`));
      }, timeout);
    });
  }

  // Handle incoming data
  handleIncomingData(data) {
    try {
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        this.handleControlMessage(message);
      } else {
        // Binary data - must be a chunk
        this.handleChunkData(data);
      }
    } catch (error) {
      console.error('Error handling incoming data:', error);
    }
  }

  handleControlMessage(message) {
    if (message.protocol !== 'fixed-transfer') return;

    console.log('📨 Received control message:', message.type);

    switch (message.type) {
      case 'metadata':
        this.handleIncomingTransfer(message);
        break;
      
      case 'chunk-header':
        this.handleChunkHeader(message);
        break;
      
      case 'transfer-complete':
        this.handleTransferComplete(message);
        break;
      
      case 'ack':
        this.handleAck(message);
        break;
      
      case 'keepalive':
        // Connection is alive, no action needed
        break;
    }
  }

  handleIncomingTransfer(metadata) {
    console.log(`📥 Incoming file: ${metadata.name} (${this.formatSize(metadata.size)})`);
    
    const transfer = {
      id: metadata.id,
      type: 'receive',
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mimeType,
      totalChunks: metadata.totalChunks,
      chunks: new Map(),
      receivedChunks: 0,
      bytesReceived: 0,
      expectingChunk: false,
      currentChunkInfo: null
    };

    this.transfers.set(metadata.id, transfer);

    // Send acknowledgment
    this.sendControlMessage({
      protocol: 'fixed-transfer',
      type: 'ack',
      id: metadata.id,
      ackType: 'metadata'
    });
  }

  handleChunkHeader(header) {
    const transfer = this.transfers.get(header.id);
    if (!transfer) {
      console.warn('Received chunk header for unknown transfer');
      return;
    }

    transfer.expectingChunk = true;
    transfer.currentChunkInfo = header;
  }

  handleChunkData(data) {
    // Find the transfer expecting a chunk
    let transfer = null;
    for (const t of this.transfers.values()) {
      if (t.type === 'receive' && t.expectingChunk) {
        transfer = t;
        break;
      }
    }

    if (!transfer || !transfer.currentChunkInfo) {
      console.warn('Received chunk data without header');
      return;
    }

    const chunkInfo = transfer.currentChunkInfo;
    
    // Store chunk
    transfer.chunks.set(chunkInfo.chunkIndex, data);
    transfer.receivedChunks++;
    transfer.bytesReceived += data.byteLength || data.length;
    transfer.expectingChunk = false;
    transfer.currentChunkInfo = null;

    // Update progress
    const progress = (transfer.bytesReceived / transfer.size) * 100;
    console.log(`📦 Received chunk ${transfer.receivedChunks}/${transfer.totalChunks} (${progress.toFixed(1)}%)`);
    
    if (this.onProgress) {
      this.onProgress(progress, transfer.bytesReceived, transfer.size);
    }

    // Send acknowledgment every 10 chunks
    if (transfer.receivedChunks % 10 === 0) {
      this.sendControlMessage({
        protocol: 'fixed-transfer',
        type: 'ack',
        id: transfer.id,
        ackType: `chunk-${transfer.receivedChunks}`
      });
    }
  }

  handleTransferComplete(message) {
    const transfer = this.transfers.get(message.id);
    if (!transfer) return;

    console.log('✅ Transfer complete, assembling file...');
    
    // Assemble file
    const chunks = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (!chunk) {
        console.error(`Missing chunk ${i}`);
        if (this.onError) {
          this.onError(new Error(`Missing chunk ${i}`));
        }
        return;
      }
      chunks.push(chunk);
    }

    // Create blob
    const blob = new Blob(chunks, { type: transfer.mimeType });
    const url = URL.createObjectURL(blob);

    const fileInfo = {
      name: transfer.name,
      size: transfer.size,
      type: transfer.mimeType,
      url: url,
      blob: blob
    };

    console.log('✅ File assembled successfully');
    
    // Clear transfer
    this.transfers.delete(message.id);

    // Notify completion
    if (this.onComplete) {
      this.onComplete(fileInfo);
    }
    
    if (this.onFileReceived) {
      this.onFileReceived(fileInfo);
    }
  }

  handleAck(message) {
    const transfer = this.transfers.get(message.id);
    if (!transfer) return;

    const ackKey = `${message.id}-${message.ackType}`;
    const handler = transfer.acks.get(ackKey);
    if (handler) {
      handler();
      transfer.acks.delete(ackKey);
    }
  }

  sendControlMessage(message) {
    if (this.peer && this.peer.connected) {
      this.peer.send(JSON.stringify(message));
    }
  }

  pauseTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer && transfer.type === 'send') {
      transfer.isPaused = true;
      console.log('⏸️ Transfer paused');
    }
  }

  resumeTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer && transfer.type === 'send' && transfer.isPaused) {
      transfer.isPaused = false;
      console.log('▶️ Transfer resumed');
      this.streamFile(transfer);
    }
  }

  cancelTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      this.transfers.delete(transferId);
      console.log('❌ Transfer cancelled');
    }
  }

  generateTransferId() {
    return `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  destroy() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    this.transfers.clear();
  }
}

export default FixedLargeFileTransfer;