import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { adaptiveAgent, applyAdaptiveDelay, getAdaptiveChunkSize } from '../utils/SimpleAdaptiveAgent';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const useOnDemandTransfer = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('disconnected');
  
  // Separate states for different types of files
  const [availableFiles, setAvailableFiles] = useState([]); // Files others are sharing (metadata only)
  const [mySharedFiles, setMySharedFiles] = useState([]); // Files I'm sharing (actual File objects)
  const [downloadedFiles, setDownloadedFiles] = useState([]); // Files I've downloaded
  const [activeDownloads, setActiveDownloads] = useState([]); // Currently downloading
  
  const peerRef = useRef(null);
  const fileRefsMap = useRef(new Map()); // Map file IDs to actual File objects
  const activeTransfersRef = useRef(new Map());
  const wakeLockRef = useRef(null);

  // Initialize socket connection
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

  // Handle incoming messages with better debugging
  const handlePeerMessage = useCallback((data) => {
    try {
      if (typeof data === 'string') {
        // String data - JSON control message
        const message = JSON.parse(data);
        console.log('📨 Received control message:', message.type, message);
        handleControlMessage(message);
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        // Try to decode as string first to check if it's JSON
        try {
          const decoder = new TextDecoder();
          const text = decoder.decode(data);
          const message = JSON.parse(text);
          console.log('📨 Received control message (decoded from binary):', message.type, message);
          handleControlMessage(message);
        } catch (decodeError) {
          // Not JSON, treat as file chunk
          console.log('📦 Received binary file chunk:', data.byteLength || data.length, 'bytes');
          handleFileChunk(data);
        }
      } else {
        // Other binary data types
        console.log('📦 Received binary chunk:', data.byteLength || data.length, 'bytes');
        handleFileChunk(data);
      }
    } catch (error) {
      console.error('❌ Error handling peer message:', error);
    }
  }, []);

  const handleControlMessage = (message) => {
    switch (message.type) {
      case 'adaptive-feedback':
        // Handle adaptive rate control feedback
        adaptiveAgent.processFeedback(message);
        console.log('📊 Processed adaptive feedback:', adaptiveAgent.getStats());
        break;
      case 'file-metadata':
        console.log('📋 Processing file metadata:', message);
        handleFileMetadata(message);
        break;
      case 'download-request':
        handleDownloadRequest(message);
        break;
      case 'download-start':
        handleDownloadStart(message);
        break;
      case 'file-chunk-header':
        handleChunkHeader(message);
        break;
      case 'download-complete':
        handleDownloadComplete(message);
        break;
      case 'download-error':
        handleDownloadError(message);
        break;
      case 'files-list-request':
        console.log('📋 Peer requested file list, sending my shared files...', mySharedFiles.length, 'files');
        sendMyFilesList();
        break;
      case 'sync-request':
        console.log('🔄 Peer requested sync, exchanging file lists...');
        sendMyFilesList();
        break;
      case 'ping':
        console.log('🏓 Received ping, sending pong');
        sendPong();
        break;
      case 'pong':
        console.log('🏓 Received pong');
        break;
      case 'keepalive':
        console.log(`💓 Received keepalive for transfer ${message.transferId} at chunk ${message.chunkIndex}`);
        // Send keepalive response
        if (peerRef.current && peerRef.current.connected) {
          peerRef.current.send(JSON.stringify({ 
            type: 'keepalive-ack', 
            transferId: message.transferId 
          }));
        }
        break;
      case 'keepalive-ack':
        console.log(`💓 Keepalive acknowledged for transfer ${message.transferId}`);
        break;
    }
  };

  // Handle file metadata from peer (they're sharing a file)
  const handleFileMetadata = (metadata) => {
    console.log(`📋 Peer is sharing: ${metadata.name} (${formatSize(metadata.size)})`);
    
    const fileInfo = {
      id: metadata.fileId,
      name: metadata.name,
      size: metadata.size,
      type: metadata.mimeType,
      timestamp: metadata.timestamp,
      isAvailable: true,
      peerId: metadata.peerId || 'peer'
    };

    setAvailableFiles(prev => {
      const existing = prev.find(f => f.id === fileInfo.id);
      if (existing) {
        console.log(`📁 Updated existing file: ${fileInfo.name}`);
        return prev.map(f => f.id === fileInfo.id ? fileInfo : f);
      } else {
        console.log(`📁 Added new available file: ${fileInfo.name}`);
        return [...prev, fileInfo];
      }
    });
  };

  // Send ping to test connection
  const sendPing = () => {
    if (peerRef.current && peerRef.current.connected) {
      console.log('🏓 Sending ping');
      peerRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  };

  const sendPong = () => {
    if (peerRef.current && peerRef.current.connected) {
      peerRef.current.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  };

  // Handle download request from peer
  const handleDownloadRequest = async (request) => {
    console.log(`📤 Peer requested download: ${request.fileName} (ID: ${request.fileId})`);
    
    const fileRef = fileRefsMap.current.get(request.fileId);
    if (!fileRef) {
      console.error(`❌ File not found: ${request.fileId}`);
      console.log('Available files in map:', Array.from(fileRefsMap.current.keys()));
      // Send error
      if (peerRef.current && peerRef.current.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'download-error',
          requestId: request.requestId,
          error: 'File not found or no longer available'
        }));
      }
      return;
    }

    // Start sending the file
    await startFileUpload(fileRef, request);
  };

  // Start uploading file to peer
  const startFileUpload = async (file, request) => {
    const transferId = request.requestId;
    const CHUNK_SIZE = getAdaptiveChunkSize(131072); // Use adaptive chunk size, defaulting to 128KB max
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    console.log(`🚀 Starting upload: ${file.name} (${formatSize(file.size)})`);

    try {
      // Send download start confirmation
      peerRef.current.send(JSON.stringify({
        type: 'download-start',
        requestId: transferId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks: totalChunks,
        chunkSize: CHUNK_SIZE
      }));

      // Track upload progress
      const uploadProgress = {
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        isUploading: true,
        progress: 0,
        speed: 0,
        startTime: Date.now(),
        bytesTransferred: 0
      };

      setActiveDownloads(prev => [...prev, uploadProgress]);

      // Request wake lock for large transfers
      await requestWakeLock();

      // Stream file chunks
      let offset = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check if peer is still connected
        if (!peerRef.current || !peerRef.current.connected) {
          throw new Error('Peer disconnected during upload');
        }

        // Wait for buffer to clear with timeout and connection check
        try {
          await waitForBuffer(peerRef.current);
        } catch (bufferError) {
          console.warn('⚠️ Buffer timeout, checking connection...');
          
          // Check if connection is still alive
          if (!peerRef.current || !peerRef.current.connected) {
            throw new Error('Connection lost during buffer wait');
          }
          
          await delay(200); // Give extra time for connection to recover
        }

        // Read chunk
        const chunk = await readFileChunk(file, offset, CHUNK_SIZE);

        // Send chunk header
        peerRef.current.send(JSON.stringify({
          type: 'file-chunk-header',
          transferId: transferId,
          chunkIndex: chunkIndex,
          chunkSize: chunk.byteLength,
          isLast: chunkIndex === totalChunks - 1
        }));

        await delay(10); // Small delay for connection stability

        // Send chunk data with retry logic
        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {
          try {
            if (!peerRef.current || !peerRef.current.connected) {
              throw new Error('Peer disconnected');
            }
            peerRef.current.send(chunk);
            break; // Success
          } catch (sendError) {
            retries++;
            console.warn(`⚠️ Send retry ${retries}/${maxRetries} for chunk ${chunkIndex}`);
            if (retries >= maxRetries) {
              throw sendError;
            }
            await delay(100 * retries); // Exponential backoff
          }
        }

        offset += chunk.byteLength;

        // Update upload progress
        const progress = (offset / file.size) * 100;
        const elapsed = (Date.now() - uploadProgress.startTime) / 1000;
        const speed = offset / elapsed;

        setActiveDownloads(prev => prev.map(d => 
          d.id === transferId 
            ? { ...d, progress, speed, bytesTransferred: offset }
            : d
        ));

        // Log progress every 1000 chunks
        if (chunkIndex % 1000 === 0 || chunkIndex === totalChunks - 1) {
          console.log(`📤 Upload progress: ${progress.toFixed(1)}% (${formatSpeed(speed)})`);
        }

        // Send keepalive every 25 chunks to maintain connection (more frequent)
        if (chunkIndex % 25 === 0 && chunkIndex > 0) {
          try {
            console.log(`💓 Sending keepalive at chunk ${chunkIndex}`);
            peerRef.current.send(JSON.stringify({ 
              type: 'keepalive', 
              transferId: transferId,
              chunkIndex: chunkIndex,
              bufferAmount: peerRef.current.bufferedAmount || 0
            }));
          } catch (keepaliveError) {
            console.warn('⚠️ Keepalive failed - connection may be unstable');
            throw new Error('Connection unstable during transfer');
          }
        }

        // Apply adaptive delay based on receiver feedback
        await applyAdaptiveDelay();
        await delay(2); // Minimal base delay for stability
      }

      // Send completion
      peerRef.current.send(JSON.stringify({
        type: 'download-complete',
        requestId: transferId
      }));

      console.log(`✅ Upload completed: ${file.name}`);

      // Remove from active downloads
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== transferId);
        // Release wake lock if no more active transfers
        if (remaining.length === 0) {
          releaseWakeLock();
        }
        return remaining;
      });

    } catch (error) {
      console.error(`❌ Upload failed: ${file.name}`, error);
      
      // Send error to peer
      if (peerRef.current && peerRef.current.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'download-error',
          requestId: transferId,
          error: error.message
        }));
      }

      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== transferId);
        // Release wake lock if no more active transfers
        if (remaining.length === 0) {
          releaseWakeLock();
        }
        return remaining;
      });
    }
  };

  // Handle download start from peer
  const handleDownloadStart = (message) => {
    console.log(`📥 Starting download: ${message.fileName} (${formatSize(message.fileSize)})`);
    
    const transfer = {
      id: message.requestId,
      fileName: message.fileName,
      fileSize: message.fileSize,
      mimeType: message.mimeType,
      totalChunks: message.totalChunks,
      isDownloading: true,
      progress: 0,
      speed: 0,
      startTime: Date.now(),
      chunks: new Array(message.totalChunks),
      receivedChunks: 0,
      bytesReceived: 0
    };

    activeTransfersRef.current.set(message.requestId, transfer);
    setActiveDownloads(prev => [...prev, transfer]);
    
    // Request wake lock for downloads too
    requestWakeLock();
  };

  // Handle chunk header
  const handleChunkHeader = (message) => {
    const transfer = activeTransfersRef.current.get(message.transferId);
    if (transfer) {
      transfer.expectedChunk = message;
    }
  };

  // Handle file chunk data
  const handleFileChunk = (chunkData) => {
    // Find the transfer expecting this chunk
    for (const [transferId, transfer] of activeTransfersRef.current.entries()) {
      if (transfer.isDownloading && transfer.expectedChunk) {
        const chunkInfo = transfer.expectedChunk;
        
        // Store chunk
        transfer.chunks[chunkInfo.chunkIndex] = chunkData;
        transfer.receivedChunks++;
        transfer.bytesReceived += chunkData.byteLength;
        transfer.progress = (transfer.bytesReceived / transfer.fileSize) * 100;
        
        // Log chunk reception for debugging
        if (chunkInfo.chunkIndex % 100 === 0 || chunkInfo.isLast) {
          console.log(`📦 Received chunk ${chunkInfo.chunkIndex}/${transfer.totalChunks} (${transfer.receivedChunks} total received)`);
        }
        
        // Calculate speed
        const elapsed = (Date.now() - transfer.startTime) / 1000;
        transfer.speed = transfer.bytesReceived / elapsed;
        
        transfer.expectedChunk = null;

        // Update UI
        setActiveDownloads(prev => prev.map(d => 
          d.id === transferId ? { ...transfer } : d
        ));

        // Log progress
        if (transfer.receivedChunks % 1000 === 0 || chunkInfo.isLast) {
          console.log(`📥 Download progress: ${transfer.progress.toFixed(1)}% (${formatSpeed(transfer.speed)})`);
        }

        // Send adaptive feedback every 15 chunks for capacity testing
        if (transfer.receivedChunks % 15 === 0 || chunkInfo.isLast) {
          try {
            // Estimate buffer level (realistic simulation)
            const pendingChunks = Math.max(0, transfer.totalChunks - transfer.receivedChunks);
            const currentBufferLevel = Math.min(pendingChunks, 20); // Realistic buffer of max 20 chunks
            const feedback = adaptiveAgent.generateFeedback(
              transfer.bytesReceived,
              currentBufferLevel
            );
            
            if (peerRef.current && peerRef.current.connected) {
              peerRef.current.send(JSON.stringify(feedback));
              const stats = adaptiveAgent.getStats();
              console.log(`📊 Speed: ${(feedback.downloadSpeed/1024/1024).toFixed(1)}MB/s | Phase: ${stats.testPhase} | Chunk: ${stats.chunkSize/1024}KB | Buffer: ${feedback.bufferLevel} ${feedback.canHandleMore ? '🚀' : '⚠️'}`);
            }
          } catch (feedbackError) {
            console.warn('⚠️ Error sending adaptive feedback:', feedbackError);
          }
        }

        break;
      }
    }
  };

  // Handle download completion
  const handleDownloadComplete = (message) => {
    const transfer = activeTransfersRef.current.get(message.requestId);
    if (!transfer) return;

    console.log(`🔧 Assembling downloaded file: ${transfer.fileName}`);

    try {
      // Check for missing chunks first
      const missingChunks = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        if (!transfer.chunks[i]) {
          missingChunks.push(i);
        }
      }
      
      if (missingChunks.length > 0) {
        console.error(`❌ Missing chunks: [${missingChunks.join(', ')}]`);
        console.log(`📊 Received ${transfer.receivedChunks}/${transfer.totalChunks} chunks`);
        
        // Try to continue with available chunks (may result in corrupted file)
        console.warn('⚠️ Attempting to assemble file with missing chunks - file may be corrupted');
      }

      // Assemble chunks (skip missing ones)
      const orderedChunks = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        if (transfer.chunks[i]) {
          orderedChunks.push(transfer.chunks[i]);
        } else {
          console.warn(`⚠️ Skipping missing chunk ${i}`);
          // Add empty chunk to maintain file structure
          orderedChunks.push(new Uint8Array(0));
        }
      }

      const blob = new Blob(orderedChunks, { type: transfer.mimeType });
      const url = URL.createObjectURL(blob);

      const downloadedFile = {
        id: Date.now() + Math.random(),
        name: transfer.fileName,
        size: transfer.fileSize,
        type: transfer.mimeType,
        url: url,
        timestamp: new Date().toISOString(),
        downloadTime: (Date.now() - transfer.startTime) / 1000
      };

      setDownloadedFiles(prev => [...prev, downloadedFile]);
      
      // Auto-download
      const a = document.createElement('a');
      a.href = url;
      a.download = transfer.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      console.log(`✅ Download completed: ${transfer.fileName} in ${formatTime(downloadedFile.downloadTime)}`);

    } catch (error) {
      console.error(`❌ Failed to assemble file: ${transfer.fileName}`, error);
    } finally {
      activeTransfersRef.current.delete(message.requestId);
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== message.requestId);
        // Release wake lock if no more active transfers
        if (remaining.length === 0) {
          releaseWakeLock();
        }
        return remaining;
      });
    }
  };

  // Handle download error
  const handleDownloadError = (message) => {
    console.error(`❌ Download error: ${message.error}`);
    activeTransfersRef.current.delete(message.requestId);
    setActiveDownloads(prev => {
      const remaining = prev.filter(d => d.id !== message.requestId);
      // Release wake lock if no more active transfers
      if (remaining.length === 0) {
        releaseWakeLock();
      }
      return remaining;
    });
    alert(`Download failed: ${message.error}`);
  };

  // Create peer connection with enhanced debugging
  const createPeer = useCallback((initiator, roomId) => {
    console.log('🔗 Creating peer connection, initiator:', initiator);
    
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      },
      // Increase buffer sizes for large file transfers
      channelConfig: {
        maxRetransmits: 10,
        ordered: true
      },
      // Add connection constraints for stability
      sdpTransform: (sdp) => {
        // Increase bandwidth for file transfers
        return sdp.replace('b=AS:30', 'b=AS:1638400'); // 1.6 GB/s max
      }
    });

    peer.on('signal', (data) => {
      console.log('📡 Sending WebRTC signal');
      socket.emit('signal', { roomId, signal: data });
    });

    peer.on('connect', () => {
      console.log('✅ Peer connected successfully!');
      setIsConnected(true);
      setStatus('connected');
      
      peer.on('data', handlePeerMessage);
      
      // Test connection with ping
      setTimeout(() => {
        console.log('🔄 Testing connection and syncing files...');
        sendPing();
        sendMyFilesList();
      }, 1000);
      
      // Send file list every 3 seconds for first 15 seconds to ensure sync
      let syncAttempts = 0;
      const syncInterval = setInterval(() => {
        if (syncAttempts < 5 && peer.connected) {
          console.log(`🔄 Sync attempt ${syncAttempts + 1}/5`);
          sendMyFilesList();
          syncAttempts++;
        } else {
          clearInterval(syncInterval);
        }
      }, 3000);
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error:', err);
      
      // Check if it's a user-initiated abort (mobile browser backgrounding)
      if (err.message && err.message.includes('User-Initiated Abort')) {
        console.warn('📱 Mobile browser backgrounded - connection lost');
        setStatus('mobile-disconnected');
      } else {
        setStatus('disconnected');
      }
      
      setIsConnected(false);
      
      // Don't immediately clear transfers - they might resume
      if (!err.message || !err.message.includes('User-Initiated Abort')) {
        setActiveDownloads([]);
        activeTransfersRef.current.clear();
      }
    });

    peer.on('close', () => {
      console.log('🔌 Peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
      setAvailableFiles([]); // Clear available files when peer disconnects
      
      // Clear active transfers on disconnect
      setActiveDownloads([]);
      activeTransfersRef.current.clear();
    });

    peerRef.current = peer;
    return peer;
  }, [socket, handlePeerMessage]);

  // Share files (metadata only) with enhanced debugging
  const shareFiles = useCallback((files) => {
    console.log(`📋 shareFiles called with ${files.length} files`);
    
    const fileArray = Array.isArray(files) ? files : [files];
    console.log(`📋 Sharing metadata for ${fileArray.length} file(s)`);

    fileArray.forEach(file => {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`📎 Storing file reference:`, fileId, file.name);
      // Store actual file reference
      fileRefsMap.current.set(fileId, file);
      
      // Add to my shared files
      const sharedFile = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: new Date().toISOString(),
        file: file // Keep reference for uploads
      };
      
      setMySharedFiles(prev => {
        console.log(`📤 Adding to mySharedFiles:`, sharedFile.name);
        return [...prev, sharedFile];
      });
      
      // Send metadata to peer if connected
      if (isConnected && peerRef.current && peerRef.current.connected) {
        console.log(`📤 Sending metadata for: ${file.name}`);
        const metadata = {
          type: 'file-metadata',
          fileId: fileId,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          timestamp: sharedFile.timestamp,
          peerId: 'me'
        };
        console.log('📤 Metadata being sent:', metadata);
        peerRef.current.send(JSON.stringify(metadata));
      } else {
        console.log(`⚠️ Not connected, will send metadata when connected`);
      }
    });
  }, [isConnected]);

  // Request download from peer
  const requestDownload = useCallback((fileInfo) => {
    if (!isConnected) {
      console.warn('Not connected to peer');
      return;
    }

    const requestId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`📥 Requesting download: ${fileInfo.name}`);
    
    peerRef.current.send(JSON.stringify({
      type: 'download-request',
      requestId: requestId,
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      fileSize: fileInfo.size
    }));
  }, [isConnected]);

  // Send my files list to peer with better debugging
  const sendMyFilesList = () => {
    if (!peerRef.current || !peerRef.current.connected) {
      console.log(`⚠️ Cannot send file list - peer not connected`);
      return;
    }
    
    console.log(`📤 Sending my file list: ${mySharedFiles.length} files`);
    console.log('Files to send:', mySharedFiles.map(f => ({ id: f.id, name: f.name, size: f.size })));
    
    // Send individual metadata for each file
    mySharedFiles.forEach(file => {
      const metadata = {
        type: 'file-metadata',
        fileId: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        timestamp: file.timestamp,
        peerId: 'me'
      };
      console.log(`📤 Sending metadata:`, metadata);
      peerRef.current.send(JSON.stringify(metadata));
    });

    if (mySharedFiles.length === 0) {
      console.log('📤 No files to share');
    }
  };

  // Refresh available files (public method)
  const refreshAvailableFiles = useCallback(() => {
    console.log('🔄 Refreshing available files...');
    if (peerRef.current && peerRef.current.connected) {
      console.log('🔄 Sending files-list-request');
      peerRef.current.send(JSON.stringify({ type: 'files-list-request' }));
      
      // Also send ping to test connection
      sendPing();
    } else {
      console.log('⚠️ Cannot refresh - peer not connected');
    }
  }, []);

  // Auto-send files when connection is established
  useEffect(() => {
    if (isConnected && mySharedFiles.length > 0) {
      console.log('🔄 Connection established, auto-sending file list...');
      setTimeout(() => {
        sendMyFilesList();
      }, 1000);
    }
  }, [isConnected, mySharedFiles.length]);

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

  const waitForBuffer = (peer, threshold = 32 * 1024) => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 100; // 5 seconds max wait
      
      const checkBuffer = () => {
        if (!peer || !peer.connected) {
          reject(new Error('Peer disconnected while waiting for buffer'));
          return;
        }
        
        attempts++;
        const bufferAmount = peer.bufferedAmount || 0;
        
        if (bufferAmount < threshold) {
          resolve();
        } else if (attempts >= maxAttempts) {
          console.warn(`⚠️ Buffer still at ${bufferAmount} bytes after ${attempts} attempts - continuing anyway`);
          resolve(); // Don't reject, just continue
        } else {
          setTimeout(checkBuffer, 50);
        }
      };
      checkBuffer();
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

  // Wake lock management for mobile devices
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('📱 Wake lock acquired - screen will stay on');
        
        wakeLockRef.current.addEventListener('release', () => {
          console.log('📱 Wake lock released');
        });
        
        return true;
      } catch (err) {
        console.warn('⚠️ Wake lock failed:', err);
        return false;
      }
    }
    return false;
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('📱 Wake lock released manually');
      } catch (err) {
        console.warn('⚠️ Wake lock release failed:', err);
      }
    }
  };

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    const handleRoomCreated = ({ roomId }) => {
      console.log('🏠 Room created:', roomId);
      setRoomId(roomId);
      setStatus('waiting');
    };

    const handleRoomJoined = ({ roomId }) => {
      console.log('🚪 Room joined:', roomId);
      setRoomId(roomId);
      createPeer(true, roomId);
      setStatus('waiting');
    };

    const handlePeerJoined = () => {
      console.log('👋 Peer joined room');
      if (!peerRef.current) {
        createPeer(false, roomId);
      }
    };

    const handleSignal = ({ signal }) => {
      console.log('📡 Received WebRTC signal');
      if (peerRef.current) {
        peerRef.current.signal(signal);
      }
    };

    const handlePeerLeft = () => {
      console.log('👋 Peer left room');
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      setIsConnected(false);
      setStatus('waiting');
      setAvailableFiles([]);
    };

    const handleRoomError = ({ message }) => {
      console.error('🏠 Room error:', message);
      alert(message);
      setStatus('disconnected');
    };

    socket.on('room-created', handleRoomCreated);
    socket.on('room-joined', handleRoomJoined);
    socket.on('peer-joined', handlePeerJoined);
    socket.on('signal', handleSignal);
    socket.on('peer-left', handlePeerLeft);
    socket.on('room-error', handleRoomError);

    return () => {
      socket.off('room-created', handleRoomCreated);
      socket.off('room-joined', handleRoomJoined);
      socket.off('peer-joined', handlePeerJoined);
      socket.off('signal', handleSignal);
      socket.off('peer-left', handlePeerLeft);
      socket.off('room-error', handleRoomError);
    };
  }, [socket, roomId, createPeer]);

  // Public API
  const createRoom = useCallback(() => {
    if (socket) {
      console.log('🏠 Creating room...');
      socket.emit('create-room');
    }
  }, [socket]);

  const joinRoom = useCallback((roomCode) => {
    if (socket && roomCode) {
      console.log('🚪 Joining room:', roomCode);
      socket.emit('join-room', roomCode);
    }
  }, [socket]);

  return {
    roomId,
    isConnected,
    status,
    availableFiles,      // Files peer is sharing (can download)
    mySharedFiles,       // Files I'm sharing
    downloadedFiles,     // Files I've downloaded
    activeDownloads,     // Current transfers
    shareFiles,          // Share files (metadata only)
    requestDownload,     // Start downloading a file
    refreshAvailableFiles, // Refresh peer's file list
    sendPing,            // Test connection
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed,
    formatTime,
    getAdaptiveStats: () => adaptiveAgent.getStats() // Get current adaptive stats
  };
};