import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const useHeavyDutyTransfer = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [transfers, setTransfers] = useState([]); // Array of active transfers
  const [sharedFiles, setSharedFiles] = useState([]);
  const [status, setStatus] = useState('disconnected');
  
  const peerRef = useRef(null);
  const activeTransfersRef = useRef(new Map());
  const resumeDataRef = useRef(new Map());

  // Enhanced transfer tracking
  const createTransfer = (file, isReceiving = false) => {
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const CHUNK_SIZE = 64 * 1024; // 64KB for better throughput on large files
    
    const transfer = {
      id: transferId,
      name: file.name || file.fileName,
      size: file.size || file.fileSize,
      type: file.type || file.mimeType || 'application/octet-stream',
      isReceiving,
      progress: 0,
      bytesTransferred: 0,
      startTime: Date.now(),
      lastActivity: Date.now(),
      speed: 0,
      eta: 0,
      status: 'active', // active, paused, completed, failed
      chunks: isReceiving ? [] : null,
      totalChunks: Math.ceil((file.size || file.fileSize) / CHUNK_SIZE),
      processedChunks: 0,
      chunkSize: CHUNK_SIZE,
      file: isReceiving ? null : file,
      resumePoint: 0,
      errors: [],
      retryCount: 0,
      maxRetries: 3
    };

    return transfer;
  };

  // Save transfer state for resume capability
  const saveTransferState = (transfer) => {
    const resumeData = {
      id: transfer.id,
      name: transfer.name,
      size: transfer.size,
      type: transfer.type,
      resumePoint: transfer.processedChunks,
      timestamp: Date.now()
    };
    
    localStorage.setItem(`transfer_${transfer.id}`, JSON.stringify(resumeData));
  };

  // Load transfer state for resume
  const loadTransferState = (transferId) => {
    try {
      const data = localStorage.getItem(`transfer_${transferId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  };

  // Enhanced file chunking with better performance
  const sendLargeFile = async (transfer) => {
    const peer = peerRef.current;
    if (!peer || !peer.connected) {
      transfer.status = 'failed';
      transfer.errors.push('Peer disconnected');
      updateTransfer(transfer);
      return;
    }

    try {
      // Send initial metadata
      const metadata = {
        type: 'heavy-transfer-start',
        transferId: transfer.id,
        name: transfer.name,
        size: transfer.size,
        mimeType: transfer.type,
        totalChunks: transfer.totalChunks,
        chunkSize: transfer.chunkSize,
        resumePoint: transfer.resumePoint
      };

      peer.send(JSON.stringify(metadata));
      await delay(200); // Give time for metadata processing

      // Resume from saved point if applicable
      let startChunk = transfer.resumePoint;
      let offset = startChunk * transfer.chunkSize;

      console.log(`🚀 Starting heavy transfer: ${transfer.name}`);
      console.log(`📊 Size: ${formatSize(transfer.size)}, Chunks: ${transfer.totalChunks}`);
      
      if (startChunk > 0) {
        console.log(`🔄 Resuming from chunk ${startChunk} (${formatSize(offset)})`);
      }

      for (let chunkIndex = startChunk; chunkIndex < transfer.totalChunks; chunkIndex++) {
        // Check if transfer was paused or cancelled
        if (transfer.status !== 'active') {
          console.log(`⏸️ Transfer ${transfer.status}: ${transfer.name}`);
          break;
        }

        // Wait for buffer to clear - critical for large files
        await waitForLowBuffer(peer, 128 * 1024); // 128KB threshold

        // Read chunk
        const chunkData = await readFileChunk(transfer.file, offset, transfer.chunkSize);
        
        // Send chunk header first
        const chunkHeader = {
          type: 'heavy-chunk-header',
          transferId: transfer.id,
          chunkIndex: chunkIndex,
          chunkSize: chunkData.byteLength,
          isLast: chunkIndex === transfer.totalChunks - 1
        };

        peer.send(JSON.stringify(chunkHeader));
        await delay(10); // Brief pause between header and data

        // Send actual chunk data
        peer.send(chunkData);
        
        // Update progress
        offset += chunkData.byteLength;
        transfer.bytesTransferred = offset;
        transfer.processedChunks = chunkIndex + 1;
        transfer.progress = (transfer.bytesTransferred / transfer.size) * 100;
        transfer.lastActivity = Date.now();
        
        // Calculate speed and ETA
        const elapsed = (Date.now() - transfer.startTime) / 1000;
        transfer.speed = transfer.bytesTransferred / elapsed;
        transfer.eta = transfer.speed > 0 ? (transfer.size - transfer.bytesTransferred) / transfer.speed : 0;

        updateTransfer(transfer);

        // Save progress every 100 chunks for resume capability
        if (chunkIndex % 100 === 0) {
          saveTransferState(transfer);
        }

        // Log progress every 1000 chunks to avoid spam
        if (chunkIndex % 1000 === 0 || chunkIndex === transfer.totalChunks - 1) {
          console.log(`📦 Heavy transfer progress: ${transfer.progress.toFixed(1)}% (${formatSize(transfer.bytesTransferred)}/${formatSize(transfer.size)}) - ${formatSpeed(transfer.speed)} - ETA: ${formatTime(transfer.eta)}`);
        }

        // Adaptive delay based on buffer pressure
        const bufferAmount = peer.bufferedAmount || 0;
        const adaptiveDelay = Math.min(50, Math.max(1, bufferAmount / 1024)); // 1-50ms based on buffer
        await delay(adaptiveDelay);
      }

      // Send completion message
      peer.send(JSON.stringify({
        type: 'heavy-transfer-complete',
        transferId: transfer.id
      }));

      transfer.status = 'completed';
      transfer.progress = 100;
      updateTransfer(transfer);

      // Add to shared files
      const url = URL.createObjectURL(transfer.file);
      const fileInfo = {
        id: Date.now() + Math.random(),
        name: transfer.name,
        size: transfer.size,
        type: transfer.type,
        url: url,
        timestamp: new Date().toISOString(),
        isOwn: true,
        transferTime: (Date.now() - transfer.startTime) / 1000
      };
      
      setSharedFiles(prev => [...prev, fileInfo]);
      
      // Clean up resume data
      localStorage.removeItem(`transfer_${transfer.id}`);
      
      console.log(`✅ Heavy transfer completed: ${transfer.name} in ${formatTime(fileInfo.transferTime)}`);

    } catch (error) {
      console.error(`❌ Heavy transfer failed: ${transfer.name}`, error);
      transfer.status = 'failed';
      transfer.errors.push(error.message);
      updateTransfer(transfer);
    }
  };

  // Enhanced buffer waiting with better thresholds for large files
  const waitForLowBuffer = (peer, threshold = 64 * 1024) => {
    return new Promise(resolve => {
      const checkBuffer = () => {
        const bufferAmount = peer.bufferedAmount || 0;
        
        if (bufferAmount < threshold) {
          resolve();
        } else {
          // Use exponential backoff for very large buffers
          const delay = bufferAmount > threshold * 4 ? 100 : 50;
          setTimeout(checkBuffer, delay);
        }
      };
      checkBuffer();
    });
  };

  // Handle incoming heavy transfer data
  const handleHeavyTransferData = useCallback((data) => {
    try {
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        
        switch (message.type) {
          case 'heavy-transfer-start':
            handleHeavyTransferStart(message);
            break;
          case 'heavy-chunk-header':
            handleHeavyChunkHeader(message);
            break;
          case 'heavy-transfer-complete':
            handleHeavyTransferComplete(message);
            break;
        }
      } else {
        // Binary chunk data
        handleHeavyChunkData(data);
      }
    } catch (error) {
      console.error('Error handling heavy transfer data:', error);
    }
  }, []);

  const handleHeavyTransferStart = (message) => {
    console.log(`📥 Starting heavy transfer receive: ${message.name} (${formatSize(message.size)})`);
    
    const transfer = createTransfer(message, true);
    transfer.totalChunks = message.totalChunks;
    transfer.chunkSize = message.chunkSize;
    
    // Check for resume capability
    const resumeData = loadTransferState(message.transferId);
    if (resumeData && resumeData.resumePoint > 0) {
      transfer.resumePoint = resumeData.resumePoint;
      transfer.processedChunks = resumeData.resumePoint;
      transfer.bytesTransferred = resumeData.resumePoint * transfer.chunkSize;
      transfer.progress = (transfer.bytesTransferred / transfer.size) * 100;
      console.log(`🔄 Resuming receive from chunk ${resumeData.resumePoint}`);
    }
    
    activeTransfersRef.current.set(message.transferId, transfer);
    updateTransfer(transfer);
  };

  const handleHeavyChunkHeader = (message) => {
    const transfer = activeTransfersRef.current.get(message.transferId);
    if (transfer) {
      transfer.expectedChunk = message;
    }
  };

  const handleHeavyChunkData = (chunkData) => {
    // Find transfer expecting this chunk
    for (const [transferId, transfer] of activeTransfersRef.current.entries()) {
      if (transfer.isReceiving && transfer.expectedChunk) {
        const chunkInfo = transfer.expectedChunk;
        
        // Store chunk
        transfer.chunks[chunkInfo.chunkIndex] = chunkData;
        transfer.processedChunks++;
        transfer.bytesTransferred += chunkData.byteLength;
        transfer.progress = (transfer.bytesTransferred / transfer.size) * 100;
        transfer.lastActivity = Date.now();
        
        // Calculate speed
        const elapsed = (Date.now() - transfer.startTime) / 1000;
        transfer.speed = transfer.bytesTransferred / elapsed;
        transfer.eta = transfer.speed > 0 ? (transfer.size - transfer.bytesTransferred) / transfer.speed : 0;
        
        transfer.expectedChunk = null;
        updateTransfer(transfer);
        
        // Save progress periodically
        if (transfer.processedChunks % 100 === 0) {
          saveTransferState(transfer);
        }

        // Log progress
        if (transfer.processedChunks % 1000 === 0) {
          console.log(`📦 Heavy receive progress: ${transfer.progress.toFixed(1)}% - ${formatSpeed(transfer.speed)} - ETA: ${formatTime(transfer.eta)}`);
        }
        
        break;
      }
    }
  };

  const handleHeavyTransferComplete = (message) => {
    const transfer = activeTransfersRef.current.get(message.transferId);
    if (!transfer) return;

    console.log(`🔧 Assembling heavy file: ${transfer.name}`);
    
    try {
      // Assemble chunks in order
      const orderedChunks = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        if (transfer.chunks[i]) {
          orderedChunks.push(transfer.chunks[i]);
        } else {
          throw new Error(`Missing chunk ${i}`);
        }
      }

      const blob = new Blob(orderedChunks, { type: transfer.type });
      const url = URL.createObjectURL(blob);
      
      const fileInfo = {
        id: Date.now() + Math.random(),
        name: transfer.name,
        size: transfer.size,
        type: transfer.type,
        url: url,
        timestamp: new Date().toISOString(),
        isOwn: false,
        transferTime: (Date.now() - transfer.startTime) / 1000
      };

      setSharedFiles(prev => [...prev, fileInfo]);
      
      transfer.status = 'completed';
      transfer.progress = 100;
      updateTransfer(transfer);
      
      // Clean up
      activeTransfersRef.current.delete(message.transferId);
      localStorage.removeItem(`transfer_${message.transferId}`);
      
      console.log(`✅ Heavy file received: ${transfer.name} in ${formatTime(fileInfo.transferTime)}`);

    } catch (error) {
      console.error(`❌ Failed to assemble heavy file: ${transfer.name}`, error);
      transfer.status = 'failed';
      transfer.errors.push(error.message);
      updateTransfer(transfer);
    }
  };

  // Update transfer in state
  const updateTransfer = (transfer) => {
    setTransfers(prev => {
      const index = prev.findIndex(t => t.id === transfer.id);
      if (index >= 0) {
        const newTransfers = [...prev];
        newTransfers[index] = { ...transfer };
        return newTransfers;
      } else {
        return [...prev, { ...transfer }];
      }
    });
  };

  // Create peer connection with heavy transfer support
  const createPeer = useCallback((initiator, roomId) => {
    console.log('🔗 Creating heavy-duty peer connection');
    
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (data) => {
      socket.emit('signal', { roomId, signal: data });
    });

    peer.on('connect', () => {
      console.log('✅ Heavy-duty peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      peer.on('data', handleHeavyTransferData);
    });

    peer.on('error', (err) => {
      console.error('❌ Heavy peer error:', err);
      setIsConnected(false);
      setStatus('disconnected');
    });

    peer.on('close', () => {
      console.log('🔌 Heavy peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
    });

    peerRef.current = peer;
    return peer;
  }, [socket, handleHeavyTransferData]);

  // Public API
  const sendHeavyFile = useCallback(async (file) => {
    if (!isConnected) {
      console.warn('Not connected to peer');
      return;
    }

    console.log(`🚀 Starting heavy file transfer: ${file.name} (${formatSize(file.size)})`);
    
    const transfer = createTransfer(file, false);
    activeTransfersRef.current.set(transfer.id, transfer);
    updateTransfer(transfer);
    
    await sendLargeFile(transfer);
  }, [isConnected]);

  // Utility functions
  const readFileChunk = (file, offset, size) => {
    return new Promise((resolve, reject) => {
      const slice = file.slice(offset, Math.min(offset + size, file.size));
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(slice);
    });
  };

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const formatSize = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatSpeed = (bytesPerSecond) => {
    return `${formatSize(bytesPerSecond)}/s`;
  };

  const formatTime = (seconds) => {
    if (!seconds || seconds === Infinity) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  // ... (socket connection logic same as before)
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
    
    newSocket.on('connect', () => {
      console.log('✅ Connected to signaling server');
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.close();
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  return {
    // ... other exports
    sendHeavyFile,
    transfers,
    formatSize,
    formatSpeed,
    formatTime
  };
};