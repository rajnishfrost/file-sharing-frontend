import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { adaptiveAgent, applyAdaptiveDelay, getAdaptiveChunkSize } from '../utils/SimpleAdaptiveAgent';
import { SpeedTester } from '../utils/speedTest';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const useOnDemandTransfer = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('disconnected');
  const [detectedSpeed, setDetectedSpeed] = useState(null);
  
  // Separate states for different types of files
  const [availableFiles, setAvailableFiles] = useState([]); // Files others are sharing (metadata only)
  const [mySharedFiles, setMySharedFiles] = useState([]); // Files I'm sharing (actual File objects)
  const [downloadedFiles, setDownloadedFiles] = useState([]); // Files I've downloaded
  const [completedDownloads, setCompletedDownloads] = useState(new Set()); // Track completed file IDs
  const [activeDownloads, setActiveDownloads] = useState([]); // Currently downloading
  const [downloadQueue, setDownloadQueue] = useState([]); // Queue for pending downloads
  const [isDownloadingAll, setIsDownloadingAll] = useState(false); // Track if download all is active
  
  const peerRef = useRef(null);
  const speedTesterRef = useRef(null);
  const fileRefsMap = useRef(new Map()); // Map file IDs to actual File objects
  const activeTransfersRef = useRef(new Map());
  const isProcessingQueue = useRef(false);
  const downloadAllLock = useRef(false); // Prevent rapid downloadAll calls
  const queueProcessingLock = useRef(false); // Prevent multiple queue processing
  const queueProcessingStarted = useRef(false); // Track if queue processing has started
  const downloadAllExecuted = useRef(false); // Track if downloadAll has been executed
  const speedCapabilitiesExchanged = useRef(false); // Track if speed capabilities have been exchanged
  const speedTestCompleted = useRef(false); // Track if speed test has been completed


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

        // Route to speed tester if it's a speed test message
        if (speedTesterRef.current && message.type && message.type.startsWith('speed-test-')) {
          speedTesterRef.current.handleMessage(message);
        }

        handleControlMessage(message);
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        // Pass to speed tester for binary data handling during tests
        if (speedTesterRef.current) {
          speedTesterRef.current.handleIncomingData(data);
        }

        // Try to decode as string first to check if it's JSON
        try {
          const decoder = new TextDecoder();
          const text = decoder.decode(data);
          const message = JSON.parse(text);
          console.log('📨 Received control message (decoded from binary):', message.type, message);
          handleControlMessage(message);
        } catch (decodeError) {
          // Not JSON, treat as file chunk (if not consumed by speed test)
          if (!speedTesterRef.current || !speedTesterRef.current.downloadTestActive) {
            console.log('📦 Received binary file chunk:', data.byteLength || data.length, 'bytes');
            handleFileChunk(data);
          }
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
      case 'speed-capabilities':
        // Handle speed capabilities exchange
        console.log('📊 Received peer speed capabilities:', message);
        console.log(`📊 Peer Upload: ${message.uploadSpeed} MBps, Peer Download: ${message.downloadSpeed} MBps`);

        // Calculate UATD = min(my upload, their download)
        const myUpload = adaptiveAgent.myUploadSpeed || adaptiveAgent.uploadSpeedMBps || 0.1;
        const theirDownload = message.downloadSpeed;
        const uatd = Math.min(myUpload, theirDownload);

        console.log(`📊 Calculating UATD:`);
        console.log(`   My Upload: ${myUpload.toFixed(2)} MBps`);
        console.log(`   Their Download: ${theirDownload.toFixed(2)} MBps`);
        console.log(`   UATD = min(${myUpload.toFixed(2)}, ${theirDownload.toFixed(2)}) = ${uatd.toFixed(2)} MBps`);

        // Update the detected speed and slider
        setDetectedSpeed(uatd);
        adaptiveAgent.setUploadSpeed(uatd);

        adaptiveAgent.setSpeedCapabilities(
          myUpload, // Our upload
          adaptiveAgent.myDownloadSpeed || 100, // Our download
          message.uploadSpeed, // Remote upload
          message.downloadSpeed // Remote download
        );

        // Send our capabilities back if not already sent
        if (!speedCapabilitiesExchanged.current && speedTestCompleted.current) {
          speedCapabilitiesExchanged.current = true;
          const localCapabilities = {
            type: 'speed-capabilities',
            uploadSpeed: adaptiveAgent.myUploadSpeed || adaptiveAgent.uploadSpeedMBps,
            downloadSpeed: adaptiveAgent.myDownloadSpeed || 100,
            deviceType: navigator.userAgent
          };
          peerRef.current.send(JSON.stringify(localCapabilities));
          console.log('📤 Sent my speed capabilities to peer:', localCapabilities);
        }
        break;
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
      case 'speed-test-upload-start':
      case 'speed-test-upload-end':
      case 'speed-test-download-start':
      case 'speed-test-download-end':
      case 'speed-test-request-download':
        // Handle speed test messages
        if (peerRef.current) {
          SpeedTester.handleSpeedTestMessage(message, peerRef.current);
        }
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
    
    // Check if there's already an active upload (this device uploading to peer)
    const hasActiveUpload = Array.from(activeTransfersRef.current.values()).some(transfer => transfer.isUploading);
    if (hasActiveUpload) {
      console.log(`🚫 Upload rejected: ${request.fileName} - already uploading another file`);
      if (peerRef.current && peerRef.current.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'download-error',
          requestId: request.requestId,
          error: 'Server busy - another file is currently being uploaded'
        }));
      }
      return;
    }
    
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
    
    // Reset adaptive agent for new transfer
    adaptiveAgent.resetForNewTransfer();
    
    // Get initial chunk size from adaptive agent
    const initialChunkSize = getAdaptiveChunkSize(131072);
    // Calculate total chunks based on initial chunk size
    const totalChunks = Math.ceil(file.size / initialChunkSize);

    console.log(`🚀 Starting upload: ${file.name} (${formatSize(file.size)}) - Two-phase strategy`);

    try {
      // Send download start confirmation
      peerRef.current.send(JSON.stringify({
        type: 'download-start',
        requestId: transferId,
        fileId: request.fileId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks: totalChunks,
        chunkSize: initialChunkSize
      }));

      // Starting upload

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


      // Stream file chunks
      let offset = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check if peer is still connected
        if (!peerRef.current || !peerRef.current.connected) {
          throw new Error('Peer disconnected during upload');
        }
        
        // Get current chunk size dynamically from adaptive agent
        const currentChunkSize = getAdaptiveChunkSize(initialChunkSize);
        if (currentChunkSize === 0) {
          console.log(`⏸️ Upload paused at chunk ${chunkIndex} - waiting for phase transition...`);
          await delay(100); // Wait 100ms and check again
          chunkIndex--; // Retry this chunk
          continue;
        }
        
        // Ensure we don't read beyond file size
        const remainingBytes = file.size - offset;
        const actualChunkSize = Math.min(currentChunkSize, remainingBytes);

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

        // Read chunk using current adaptive size
        const chunk = await readFileChunk(file, offset, actualChunkSize);

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

      // Upload completed

      // Remove from active downloads
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== transferId);
        return remaining;
      });

    } catch (error) {
      console.error(`❌ Upload failed: ${file.name}`, error);
      
      // Upload error
      
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
        return remaining;
      });
    }
  };

  // Handle download start from peer
  const handleDownloadStart = (message) => {
    console.log(`📥 Starting download: ${message.fileName} (${formatSize(message.fileSize)})`);
    
    // Simple check - only allow one download at a time (use ref for immediate check)
    const hasActiveDownload = activeTransfersRef.current.size > 0;
    if (hasActiveDownload) {
      console.error(`🚫 Download rejected: ${message.fileName} - already downloading another file (${activeTransfersRef.current.size} active)`);
      // Send error back to peer
      if (peerRef.current && peerRef.current.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'download-error',
          requestId: message.requestId,
          error: 'Already downloading another file'
        }));
      }
      return;
    }
    
    const transfer = {
      id: message.requestId,
      fileId: message.fileId,
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

        // Send feedback every 50 chunks - much less frequent to avoid interference 
        if (transfer.receivedChunks % 50 === 0 || chunkInfo.isLast) {
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
              console.log(`📊 Phase: ${stats.transferPhase} | Download: ${(feedback.downloadSpeed/1024/1024).toFixed(1)}MB/s | Upload: ${stats.chunkSize/1024}KB, ${stats.sendDelay}ms | Buffer: ${feedback.bufferLevel}`);
            }
          } catch (feedbackError) {
            console.warn('⚠️ Error sending adaptive feedback:', feedbackError);
          }
        }

        // Check if download is complete (received all chunks)
        if (chunkInfo.isLast || transfer.receivedChunks === transfer.totalChunks) {
          console.log(`✅ All chunks received for ${transfer.fileName} - completion will be handled naturally`);
        }

        break;
      }
    }
  };

  // Handle download completion
  const handleDownloadComplete = (message) => {
    const transfer = activeTransfersRef.current.get(message.requestId);
    if (!transfer) {
      console.error('❌ No transfer found for requestId:', message.requestId);
      return;
    }

    console.log(`🔧 Assembling downloaded file: ${transfer.fileName} (${transfer.receivedChunks}/${transfer.totalChunks} chunks)`);

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
      
      // Mark file as completed
      setCompletedDownloads(prev => new Set([...prev, transfer.fileId]));
      console.log(`✅ Marked file as completed: ${transfer.fileName} (ID: ${transfer.fileId})`);
      
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
      // Clean up transfer first
      activeTransfersRef.current.delete(message.requestId);
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== message.requestId);
        return remaining;
      });
      
      // Small delay to ensure state cleanup is complete before releasing lock
      setTimeout(() => {
        // Download completed, no lock to release
        
        // Process next item in queue if exists
        setDownloadQueue(prev => {
          if (prev.length > 0) {
            console.log(`📋 ${prev.length} files remaining in queue, processing next...`);
            // Additional delay to ensure lock is released
            setTimeout(() => processDownloadQueue(), 300);
            return prev;
          } else {
            // No more files in queue, stop download all
            console.log('✅ All downloads completed, stopping Download All');
            console.log('📊 Final download count check - remaining queue length:', prev.length);
            setIsDownloadingAll(false);
            // All downloads completed
            // Reset downloadAll flags
            downloadAllLock.current = false;
            downloadAllExecuted.current = false;
            queueProcessingStarted.current = false;
            return prev;
          }
        });
      }, 100);
    }
  };

  // Handle download error
  const handleDownloadError = (message) => {
    console.error(`❌ Download error: ${message.error}`);
    activeTransfersRef.current.delete(message.requestId);
    setActiveDownloads(prev => {
      const remaining = prev.filter(d => d.id !== message.requestId);
      return remaining;
    });
    console.log(`💭 Download failed (no popup): ${message.error}`);
    
    // Small delay to ensure cleanup before releasing lock
    setTimeout(() => {
      // Download error, no lock to release
      
      // Process next item in queue if exists
      setDownloadQueue(prev => {
        if (prev.length > 0) {
          console.log(`📋 ${prev.length} files remaining in queue, processing next after error...`);
          setTimeout(() => processDownloadQueue(), 300);
          return prev;
        } else {
          console.log('✅ All downloads completed (with errors), stopping Download All');
          setIsDownloadingAll(false);
          downloadAllLock.current = false;
          downloadAllExecuted.current = false;
          queueProcessingStarted.current = false;
          return prev;
        }
      });
    }, 100);
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

      // Initialize SpeedTester
      speedTesterRef.current = new SpeedTester(peer);

      // Test connection with ping
      setTimeout(() => {
        console.log('🔄 Testing connection and syncing files...');
        sendPing();
        sendMyFilesList();
      }, 1000);

      // Run automatic speed detection after connection stabilizes
      setTimeout(async () => {
        if (!speedTestCompleted.current && peer.connected) {
          try {
            console.log('🚀 Starting automatic speed detection...');
            const results = await speedTesterRef.current.runSpeedTest((progress) => {
              console.log('📊 Speed test progress:', progress);
            });

            console.log('✅ Speed test completed:', results);
            console.log(`📊 My Upload: ${results.upload.toFixed(2)} MBps, My Download: ${results.download.toFixed(2)} MBps`);

            // Send my speed capabilities to peer
            const myCapabilities = {
              type: 'speed-capabilities',
              uploadSpeed: results.upload,
              downloadSpeed: results.download,
              deviceType: navigator.userAgent
            };
            peer.send(JSON.stringify(myCapabilities));
            console.log('📤 Sent my speed capabilities to peer:', myCapabilities);

            // Store my speeds
            adaptiveAgent.myUploadSpeed = results.upload;
            adaptiveAgent.myDownloadSpeed = results.download;

            // Calculate initial UATD (will be refined when peer responds)
            // For now, assume peer has similar capabilities
            const initialUATD = Math.min(results.upload, results.download);

            console.log(`📊 Initial UATD: ${initialUATD.toFixed(2)} MBps (will adjust when peer responds)`);
            setDetectedSpeed(initialUATD);
            adaptiveAgent.setUploadSpeed(initialUATD);

            speedTestCompleted.current = true;
          } catch (error) {
            console.error('❌ Speed test failed:', error);
          }
        }
      }, 2000);

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
      speedCapabilitiesExchanged.current = false; // Reset speed capabilities flag
      
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

    // Simple check - only allow one download at a time (use ref for immediate check)
    const hasActiveDownload = activeTransfersRef.current.size > 0;
    if (hasActiveDownload) {
      console.log(`🔒 Already downloading, adding ${fileInfo.name} to queue (${activeTransfersRef.current.size} active)`);
      setDownloadQueue(prev => {
        // Check if already in queue
        if (prev.find(f => f.id === fileInfo.id)) {
          console.log('File already in queue:', fileInfo.name);
          return prev;
        }
        return [...prev, fileInfo];
      });
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

  // Process download queue - simplified
  const processDownloadQueue = useCallback(() => {
    // Prevent multiple simultaneous queue processing
    if (queueProcessingLock.current) {
      console.log('🔒 Queue processing already in progress, skipping');
      return;
    }
    queueProcessingLock.current = true;

    // Check if there's already an active download (use ref for immediate check)
    if (activeTransfersRef.current.size > 0) {
      console.log(`🔒 Already downloading, cannot process queue (${activeTransfersRef.current.size} active)`);
      queueProcessingLock.current = false;
      return;
    }

    setDownloadQueue(prevQueue => {
      console.log(`🔄 Processing queue: ${prevQueue.length} files`);
      console.log('📝 Queue contents:', prevQueue.map(f => f.name));
      
      // Check if queue is empty
      if (prevQueue.length === 0) {
        console.log('📭 Queue is empty, nothing to process');
        queueProcessingLock.current = false;
        return prevQueue;
      }

      // Get next file from queue
      const [nextFile, ...remainingQueue] = prevQueue;
      if (!nextFile) {
        console.log('❌ No next file found in queue');
        queueProcessingLock.current = false;
        return prevQueue;
      }

      // Start download
      const requestId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`📥 Processing queued download: ${nextFile.name} (${remainingQueue.length} files remaining)`);
      console.log('📝 Remaining files after this:', remainingQueue.map(f => f.name));
      
      if (peerRef.current && peerRef.current.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'download-request',
          requestId: requestId,
          fileId: nextFile.id,
          fileName: nextFile.name,
          fileSize: nextFile.size
        }));
      } else {
        console.warn('⚠️ Cannot send download request - peer not connected');
        // Failed to send request
        queueProcessingLock.current = false;
        return prevQueue; // Don't remove from queue if we can't send
      }

      // Release lock and return the remaining queue
      queueProcessingLock.current = false;
      return remainingQueue;
    });
  }, []);

  // Download all files sequentially - completely rewritten to avoid React issues
  const downloadAll = useCallback(() => {
    console.log('📞 downloadAll function called');
    
    // Single atomic check and set
    if (downloadAllExecuted.current) {
      console.log('🔒 Download All already executed, ignoring');
      return;
    }
    
    if (!isConnected || availableFiles.length === 0) {
      console.warn('Cannot download all: not connected or no files available');
      return;
    }

    // Immediately set execution flag
    downloadAllExecuted.current = true;
    console.log('🔒 Download All execution marked');

    // Directly set the queue and start processing - avoid React state setter issues
    const filesToAdd = availableFiles.filter(file => {
      const alreadyInQueue = downloadQueue.find(f => f.id === file.id);
      return !alreadyInQueue;
    });

    if (filesToAdd.length === 0) {
      console.log('All files are already in queue');
      downloadAllExecuted.current = false;
      return;
    }

    console.log(`📋 Directly adding ${filesToAdd.length} files to download queue`);
    console.log('📝 Files being added:', filesToAdd.map(f => f.name));

    // Set states directly
    setIsDownloadingAll(true);
    setDownloadQueue(prev => [...prev, ...filesToAdd]);

    // Start processing immediately
    setTimeout(() => {
      console.log('🚀 Starting download processing');
      processDownloadQueue();
    }, 300);

  }, [isConnected, availableFiles, downloadQueue]);

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
      speedCapabilitiesExchanged.current = false; // Reset speed capabilities flag
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
    downloadQueue,       // Files waiting to download
    isDownloadingAll,    // Is download all active
    completedDownloads,  // Track which files have been downloaded
    detectedSpeed,       // Auto-detected upload speed
    shareFiles,          // Share files (metadata only)
    requestDownload,     // Start downloading a file
    downloadAll,         // Download all files sequentially
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