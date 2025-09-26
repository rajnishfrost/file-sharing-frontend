import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Adaptive rate control constants - ULTRA CONSERVATIVE FOR STABILITY
const INITIAL_CHUNK_SIZE = 32 * 1024; // Start with 32KB - very conservative
const MIN_CHUNK_SIZE = 8 * 1024; // 8KB minimum 
const MAX_CHUNK_SIZE = 256 * 1024; // 256KB maximum - very conservative
const BUFFER_LOW_THRESHOLD = 32 * 1024; // 32KB
const BUFFER_HIGH_THRESHOLD = 512 * 1024; // 512KB buffer - much smaller
const THROUGHPUT_SAMPLE_INTERVAL = 100; // Sample every 100 chunks - very conservative
const RATE_ADJUSTMENT_FACTOR = 0.75; // Upload at 75% of receiver's capacity - very conservative

export const useAdaptiveRateTransfer = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('disconnected');
  
  const [availableFiles, setAvailableFiles] = useState([]);
  const [mySharedFiles, setMySharedFiles] = useState([]);
  const [downloadedFiles, setDownloadedFiles] = useState([]);
  const [activeDownloads, setActiveDownloads] = useState([]);
  
  const peerRef = useRef(null);
  const fileRefsMap = useRef(new Map());
  const activeTransfersRef = useRef(new Map());
  const wakeLockRef = useRef(null);
  
  // Adaptive rate control state - FAST START
  const rateControlRef = useRef({
    uploadRate: 0,
    downloadRate: 0,
    rtt: 0,
    currentChunkSize: INITIAL_CHUNK_SIZE,
    bufferPressure: 0,
    lastThroughputUpdate: Date.now(),
    throughputSamples: [],
    congestionLevel: 'normal', // 'normal', 'moderate', 'high'
    adaptiveDelayMs: 10, // Start with longer delay for stability
    receiverCapacity: Infinity,
    fastStartMode: true, // Enable fast start
    successfulChunks: 0, // Track successful transfers for speed ramp-up
    networkType: 'unknown', // 'fast', 'moderate', 'slow', 'unknown'
    connectionRetries: 0,
    maxRetries: 3,
    resumeTransfers: new Map() // Store partial transfers for resume
  });

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

  // Calculate adaptive chunk size based on network conditions - OPTIMIZED
  const calculateAdaptiveChunkSize = () => {
    const control = rateControlRef.current;
    let newChunkSize = control.currentChunkSize;
    
    // Fast start mode - more gradual scaling
    if (control.fastStartMode) {
      control.successfulChunks++;
      
      // Gradually increase chunk size every 25 successful chunks
      if (control.successfulChunks % 25 === 0) {
        newChunkSize = Math.min(MAX_CHUNK_SIZE, newChunkSize * 1.5); // 1.5x instead of 2x
      }
      
      // Exit fast start more conservatively
      if (control.congestionLevel !== 'normal' || control.bufferPressure > 0.3) {
        control.fastStartMode = false;
        console.log('📉 Exiting fast start mode due to congestion');
      }
    }
    
    // Adjust based on congestion level
    if (control.congestionLevel === 'high') {
      newChunkSize = Math.max(MIN_CHUNK_SIZE, newChunkSize * 0.7);
      control.fastStartMode = false;
    } else if (control.congestionLevel === 'moderate') {
      newChunkSize = Math.max(MIN_CHUNK_SIZE, newChunkSize * 0.85);
    } else {
      // Normal conditions - gradual increase
      if (control.bufferPressure < 0.1) {
        // Only increase when buffer is very low
        newChunkSize = Math.min(MAX_CHUNK_SIZE, newChunkSize * 1.2);
      } else if (control.bufferPressure < 0.2) {
        newChunkSize = Math.min(MAX_CHUNK_SIZE, newChunkSize * 1.1);
      }
    }
    
    // Detect network type based on successful throughput
    if (control.uploadRate > 10 * 1024 * 1024) { // > 10 MB/s
      control.networkType = 'fast';
      newChunkSize = Math.max(512 * 1024, newChunkSize); // At least 512KB for fast networks
    } else if (control.uploadRate > 1 * 1024 * 1024) { // > 1 MB/s
      control.networkType = 'moderate';
      newChunkSize = Math.max(256 * 1024, newChunkSize); // At least 256KB
    } else if (control.uploadRate > 0) {
      control.networkType = 'slow';
    }
    
    control.currentChunkSize = Math.floor(newChunkSize);
    return control.currentChunkSize;
  };

  // Calculate adaptive delay based on network conditions - VERY CONSERVATIVE DELAYS
  const calculateAdaptiveDelay = () => {
    const control = rateControlRef.current;
    
    // Start with larger base delay for stability
    let delay = 10; // Increased base delay
    
    // Adjust based on conditions
    if (control.congestionLevel === 'high') {
      delay = 50; // Much longer for stability
    } else if (control.congestionLevel === 'moderate') {
      delay = 25; // Conservative
    } else if (control.bufferPressure > 0.5) {
      delay = 20;
    } else if (control.bufferPressure > 0.2) {
      delay = 15;
    }
    
    // Network type adjustments - very conservative
    if (control.networkType === 'fast' && control.congestionLevel === 'normal') {
      delay = Math.max(5, delay); // At least 5ms even for fast networks
    } else if (control.networkType === 'moderate') {
      delay = Math.max(10, delay); // At least 10ms for moderate
    } else if (control.networkType === 'slow') {
      delay = Math.max(15, delay); // At least 15ms for slow
    }
    
    // RTT consideration
    if (control.rtt > 50) {
      delay += Math.floor(control.rtt / 25);
    }
    
    control.adaptiveDelayMs = delay;
    return delay;
  };

  // Update throughput metrics
  const updateThroughputMetrics = (bytesTransferred, timeElapsed) => {
    const control = rateControlRef.current;
    const throughput = bytesTransferred / timeElapsed;
    
    control.throughputSamples.push(throughput);
    if (control.throughputSamples.length > 10) {
      control.throughputSamples.shift();
    }
    
    // Calculate average throughput
    const avgThroughput = control.throughputSamples.reduce((a, b) => a + b, 0) / control.throughputSamples.length;
    
    // Determine congestion level
    if (avgThroughput < control.uploadRate * 0.3) {
      control.congestionLevel = 'high';
    } else if (avgThroughput < control.uploadRate * 0.6) {
      control.congestionLevel = 'moderate';
    } else {
      control.congestionLevel = 'normal';
    }
    
    control.uploadRate = avgThroughput;
  };

  // Handle incoming messages
  const handlePeerMessage = useCallback((data) => {
    try {
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        console.log('📨 Received control message:', message.type);
        handleControlMessage(message);
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        try {
          const decoder = new TextDecoder();
          const text = decoder.decode(data);
          const message = JSON.parse(text);
          console.log('📨 Received control message (decoded):', message.type);
          handleControlMessage(message);
        } catch (decodeError) {
          console.log('📦 Received binary chunk:', data.byteLength || data.length, 'bytes');
          handleFileChunk(data);
        }
      }
    } catch (error) {
      console.error('❌ Error handling peer message:', error);
    }
  }, []);

  const handleControlMessage = (message) => {
    switch (message.type) {
      case 'file-metadata':
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
      case 'throughput-report':
        handleThroughputReport(message);
        break;
      case 'buffer-pressure':
        handleBufferPressure(message);
        break;
      case 'rate-limit-request':
        handleRateLimitRequest(message);
        break;
      case 'files-list-request':
        sendMyFilesList();
        break;
      case 'ping':
        sendPong();
        break;
      case 'pong':
        const rtt = Date.now() - message.timestamp;
        rateControlRef.current.rtt = rtt;
        console.log(`🏓 RTT: ${rtt}ms`);
        break;
    }
  };

  // Handle throughput report from receiver
  const handleThroughputReport = (report) => {
    console.log(`📊 Receiver throughput: ${formatSpeed(report.throughput)}, buffer: ${report.bufferLevel}%`);
    const control = rateControlRef.current;
    control.downloadRate = report.throughput;
    control.receiverCapacity = report.throughput * RATE_ADJUSTMENT_FACTOR;
    control.bufferPressure = report.bufferLevel / 100;
  };

  // Handle buffer pressure signal
  const handleBufferPressure = (signal) => {
    console.log(`⚠️ Buffer pressure: ${signal.level} (${signal.pressure}%)`);
    const control = rateControlRef.current;
    control.bufferPressure = signal.pressure / 100;
    
    if (signal.level === 'critical') {
      control.congestionLevel = 'high';
      control.currentChunkSize = MIN_CHUNK_SIZE;
    } else if (signal.level === 'high') {
      control.congestionLevel = 'moderate';
    }
  };

  // Handle rate limit request from receiver
  const handleRateLimitRequest = (request) => {
    console.log(`🚦 Rate limit requested: ${formatSpeed(request.maxRate)}`);
    const control = rateControlRef.current;
    control.receiverCapacity = request.maxRate;
  };

  // Send throughput report to sender
  const sendThroughputReport = (transferId, throughput, bufferLevel) => {
    if (peerRef.current && peerRef.current.connected) {
      peerRef.current.send(JSON.stringify({
        type: 'throughput-report',
        transferId,
        throughput,
        bufferLevel: Math.min(100, bufferLevel * 100),
        timestamp: Date.now()
      }));
    }
  };

  // Send buffer pressure signal
  const sendBufferPressure = (transferId, level, pressure) => {
    if (peerRef.current && peerRef.current.connected) {
      peerRef.current.send(JSON.stringify({
        type: 'buffer-pressure',
        transferId,
        level,
        pressure: Math.min(100, pressure * 100),
        timestamp: Date.now()
      }));
    }
  };

  // Request rate limit from sender
  const requestRateLimit = (transferId, maxRate) => {
    if (peerRef.current && peerRef.current.connected) {
      peerRef.current.send(JSON.stringify({
        type: 'rate-limit-request',
        transferId,
        maxRate,
        timestamp: Date.now()
      }));
    }
  };

  // Handle file metadata from peer
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
        return prev.map(f => f.id === fileInfo.id ? fileInfo : f);
      } else {
        return [...prev, fileInfo];
      }
    });
  };

  // Handle download request from peer with adaptive control
  const handleDownloadRequest = async (request) => {
    console.log(`📤 Peer requested download: ${request.fileName}`);
    
    // Check if peer is still connected before processing
    if (!peerRef.current || !peerRef.current.connected) {
      console.error('❌ Cannot process download request - peer not connected');
      return;
    }
    
    const fileRef = fileRefsMap.current.get(request.fileId);
    if (!fileRef) {
      console.error(`❌ File not found: ${request.fileId}`);
      if (peerRef.current && peerRef.current.connected) {
        try {
          peerRef.current.send(JSON.stringify({
            type: 'download-error',
            requestId: request.requestId,
            error: 'File not found or no longer available'
          }));
        } catch (error) {
          console.error('Failed to send error message:', error);
        }
      }
      return;
    }

    // Start upload with error handling
    try {
      await startAdaptiveFileUpload(fileRef, request);
    } catch (error) {
      console.error('Upload failed:', error);
      // Error handling already done in startAdaptiveFileUpload
    }
  };

  // Start adaptive file upload
  const startAdaptiveFileUpload = async (file, request) => {
    const transferId = request.requestId;
    const control = rateControlRef.current;
    
    // Reset adaptive control for new transfer - START STABLE
    control.currentChunkSize = INITIAL_CHUNK_SIZE;
    control.congestionLevel = 'normal';
    control.bufferPressure = 0;
    control.throughputSamples = [];
    control.adaptiveDelayMs = 10; // Start with larger delay for stability
    control.fastStartMode = false; // Disable fast start - too aggressive
    control.successfulChunks = 0;

    console.log(`🚀 Starting adaptive upload: ${file.name} (${formatSize(file.size)})`);

    try {
      // Calculate initial parameters
      const chunkSize = calculateAdaptiveChunkSize();
      const totalChunks = Math.ceil(file.size / chunkSize);

      // Check connection before starting
      if (!peerRef.current || !peerRef.current.connected) {
        console.error('❌ Cannot start upload - peer not connected');
        throw new Error('Peer not connected');
      }

      // Send download start confirmation
      try {
        peerRef.current.send(JSON.stringify({
          type: 'download-start',
          requestId: transferId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          totalChunks: totalChunks,
          chunkSize: chunkSize,
          adaptive: true
        }));
      } catch (error) {
        console.error('❌ Failed to send download start:', error);
        throw new Error('Failed to initiate transfer');
      }

      // Track upload progress
      const uploadProgress = {
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        isUploading: true,
        progress: 0,
        speed: 0,
        startTime: Date.now(),
        bytesTransferred: 0,
        adaptiveInfo: {
          chunkSize: chunkSize,
          congestion: control.congestionLevel,
          bufferPressure: 0
        }
      };

      setActiveDownloads(prev => [...prev, uploadProgress]);
      await requestWakeLock();

      // Adaptive streaming
      let offset = 0;
      let chunkIndex = 0;
      let lastProgressUpdate = Date.now();
      let bytesSinceLastUpdate = 0;

      while (offset < file.size) {
        // Detailed connection checking with logging
        if (!peerRef.current) {
          console.error('❌ PeerRef is null at chunk', chunkIndex);
          throw new Error('Peer reference lost during upload');
        }
        
        if (!peerRef.current.connected) {
          console.error('❌ Peer not connected at chunk', chunkIndex, 'connection state:', peerRef.current.connectionState);
          throw new Error('Peer disconnected during upload');
        }
        
        // Log buffer and connection status periodically
        const bufferAmount = peerRef.current.bufferedAmount || 0;
        if (chunkIndex % 20 === 0) {
          console.log(`📊 Chunk ${chunkIndex}: Buffer ${formatSize(bufferAmount)}, Connected: ${peerRef.current.connected}, State: ${peerRef.current.connectionState || 'unknown'}`);
        }

        // Dynamic chunk size calculation
        const currentChunkSize = calculateAdaptiveChunkSize();
        const chunkEndOffset = Math.min(offset + currentChunkSize, file.size);
        const actualChunkSize = chunkEndOffset - offset;

        // Only wait for buffer if there's actual pressure
        if (peerRef.current.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
          const bufferThreshold = control.bufferPressure > 0.7 
            ? BUFFER_LOW_THRESHOLD 
            : BUFFER_HIGH_THRESHOLD;
          
          try {
            await waitForBuffer(peerRef.current, bufferThreshold);
          } catch (bufferError) {
            console.warn('⚠️ Buffer pressure detected, adjusting...');
            control.congestionLevel = 'moderate';
            sendBufferPressure(transferId, 'high', 80);
            await delay(10); // Much shorter delay
          }
        }

        // Read adaptive chunk
        const chunk = await readFileChunk(file, offset, actualChunkSize);

        // Check connection and handle disconnection
        if (!peerRef.current || !peerRef.current.connected) {
          console.warn(`⚠️ Connection lost at chunk ${chunkIndex}/${totalChunks}, attempting to handle gracefully...`);
          
          // Save transfer state for potential resume
          const control = rateControlRef.current;
          control.resumeTransfers.set(transferId, {
            file,
            request,
            offset,
            chunkIndex,
            totalChunks,
            bytesTransferred: offset,
            startTime: uploadProgress.startTime
          });
          
          // Update UI to show paused state
          setActiveDownloads(prev => prev.map(d => 
            d.id === transferId 
              ? { ...d, status: 'paused', progress: (offset / file.size) * 100 }
              : d
          ));
          
          throw new Error(`Connection lost at ${((offset / file.size) * 100).toFixed(1)}% - transfer paused`);
        }

        // Send chunk header with adaptive info
        try {
          peerRef.current.send(JSON.stringify({
            type: 'file-chunk-header',
            transferId: transferId,
            chunkIndex: chunkIndex,
            chunkSize: chunk.byteLength,
            offset: offset,
            totalSize: file.size,
            isLast: chunkEndOffset >= file.size,
            adaptive: {
              chunkSize: currentChunkSize,
              congestionLevel: control.congestionLevel,
              delay: control.adaptiveDelayMs
            }
          }));
        } catch (sendError) {
          console.error('Failed to send chunk header:', sendError);
          if (sendError.message?.includes('destroyed')) {
            throw new Error('Peer connection destroyed - transfer aborted');
          }
          throw sendError;
        }

        // Calculate and apply adaptive delay
        const adaptiveDelay = calculateAdaptiveDelay();
        await delay(adaptiveDelay);

        // Send chunk data with error handling
        try {
          if (!peerRef.current || !peerRef.current.connected) {
            throw new Error('Peer connection lost before sending chunk data');
          }
          peerRef.current.send(chunk);
        } catch (sendError) {
          console.error(`Failed to send chunk ${chunkIndex}:`, sendError);
          if (sendError.message?.includes('destroyed') || !peerRef.current?.connected) {
            throw new Error('Peer connection destroyed - transfer aborted');
          }
          throw sendError;
        }

        offset = chunkEndOffset;
        bytesSinceLastUpdate += actualChunkSize;
        chunkIndex++;

        // Update throughput metrics periodically
        const now = Date.now();
        const timeSinceUpdate = now - lastProgressUpdate;
        
        if (timeSinceUpdate >= 1000 || offset >= file.size) {
          updateThroughputMetrics(bytesSinceLastUpdate, timeSinceUpdate / 1000);
          
          const progress = (offset / file.size) * 100;
          const elapsed = (now - uploadProgress.startTime) / 1000;
          const speed = offset / elapsed;

          setActiveDownloads(prev => prev.map(d => 
            d.id === transferId 
              ? { 
                  ...d, 
                  progress, 
                  speed,
                  bytesTransferred: offset,
                  adaptiveInfo: {
                    chunkSize: currentChunkSize,
                    congestion: control.congestionLevel,
                    bufferPressure: control.bufferPressure * 100
                  }
                }
              : d
          ));

          console.log(
            `📤 Upload: ${progress.toFixed(1)}% | ` +
            `Speed: ${formatSpeed(speed)} | ` +
            `Chunk: ${formatSize(currentChunkSize)} | ` +
            `Congestion: ${control.congestionLevel} | ` +
            `Buffer: ${(control.bufferPressure * 100).toFixed(0)}%`
          );

          lastProgressUpdate = now;
          bytesSinceLastUpdate = 0;
        }

        // Send periodic throughput reports (every 20 chunks)
        if (chunkIndex % THROUGHPUT_SAMPLE_INTERVAL === 0 && chunkIndex > 0) {
          sendThroughputReport(transferId, control.uploadRate, control.bufferPressure * 100);
        }
      }

      // Send completion if still connected
      if (peerRef.current && peerRef.current.connected) {
        try {
          peerRef.current.send(JSON.stringify({
            type: 'download-complete',
            requestId: transferId,
            finalStats: {
              totalBytes: file.size,
              totalTime: (Date.now() - uploadProgress.startTime) / 1000,
              avgSpeed: control.uploadRate,
              avgChunkSize: control.currentChunkSize
            }
          }));
        } catch (error) {
          console.warn('Could not send completion signal:', error);
        }
      }

      console.log(`✅ Adaptive upload completed: ${file.name}`);

      // Clean up
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== transferId);
        if (remaining.length === 0) releaseWakeLock();
        return remaining;
      });

    } catch (error) {
      console.error(`❌ Adaptive upload failed: ${file.name}`, error);
      
      // Only try to send error if peer is still connected
      if (peerRef.current && peerRef.current.connected) {
        try {
          peerRef.current.send(JSON.stringify({
            type: 'download-error',
            requestId: transferId,
            error: error.message
          }));
        } catch (sendError) {
          console.warn('Could not send error to peer:', sendError);
        }
      }

      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== transferId);
        if (remaining.length === 0) releaseWakeLock();
        return remaining;
      });
    }
  };

  // Handle download start with adaptive control
  const handleDownloadStart = (message) => {
    console.log(`📥 Starting adaptive download: ${message.fileName} (${formatSize(message.fileSize)})`);
    
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
      chunks: [],
      receivedBytes: 0,
      lastThroughputReport: Date.now(),
      bufferSize: 0,
      maxBufferSize: 2 * 1024 * 1024, // 2MB buffer
      adaptiveInfo: {
        receiverThroughput: 0,
        bufferLevel: 0
      }
    };

    activeTransfersRef.current.set(message.requestId, transfer);
    setActiveDownloads(prev => [...prev, transfer]);
    requestWakeLock();
  };

  // Handle chunk header with adaptive info
  const handleChunkHeader = (message) => {
    const transfer = activeTransfersRef.current.get(message.transferId);
    if (transfer) {
      transfer.expectedChunk = message;
      
      // Monitor buffer pressure
      const bufferUsage = transfer.bufferSize / transfer.maxBufferSize;
      if (bufferUsage > 0.8) {
        sendBufferPressure(message.transferId, 'critical', bufferUsage * 100);
        requestRateLimit(message.transferId, transfer.adaptiveInfo.receiverThroughput * 0.7);
      } else if (bufferUsage > 0.6) {
        sendBufferPressure(message.transferId, 'high', bufferUsage * 100);
      }
      
      transfer.adaptiveInfo.bufferLevel = bufferUsage * 100;
    }
  };

  // Handle file chunk with adaptive buffering
  const handleFileChunk = (chunkData) => {
    for (const [transferId, transfer] of activeTransfersRef.current.entries()) {
      if (transfer.isDownloading && transfer.expectedChunk) {
        const chunkInfo = transfer.expectedChunk;
        
        // Add to buffer
        transfer.chunks.push({
          index: chunkInfo.chunkIndex,
          data: chunkData,
          size: chunkData.byteLength
        });
        
        transfer.receivedBytes += chunkData.byteLength;
        transfer.bufferSize += chunkData.byteLength;
        transfer.progress = (transfer.receivedBytes / transfer.fileSize) * 100;
        
        // Calculate throughput
        const elapsed = (Date.now() - transfer.startTime) / 1000;
        transfer.speed = transfer.receivedBytes / elapsed;
        transfer.adaptiveInfo.receiverThroughput = transfer.speed;
        
        transfer.expectedChunk = null;

        // Send throughput reports periodically
        const timeSinceLastReport = Date.now() - transfer.lastThroughputReport;
        if (timeSinceLastReport >= 1000) {
          const bufferLevel = (transfer.bufferSize / transfer.maxBufferSize) * 100;
          sendThroughputReport(transferId, transfer.speed, bufferLevel);
          transfer.lastThroughputReport = Date.now();
        }

        // Update UI with adaptive info
        setActiveDownloads(prev => prev.map(d => 
          d.id === transferId 
            ? { 
                ...d,
                progress: transfer.progress,
                speed: transfer.speed,
                adaptiveInfo: transfer.adaptiveInfo
              }
            : d
        ));

        if (transfer.receivedBytes % (100 * chunkData.byteLength) === 0 || chunkInfo.isLast) {
          console.log(
            `📥 Download: ${transfer.progress.toFixed(1)}% | ` +
            `Speed: ${formatSpeed(transfer.speed)} | ` +
            `Buffer: ${transfer.adaptiveInfo.bufferLevel.toFixed(0)}%`
          );
        }

        break;
      }
    }
  };

  // Handle download completion
  const handleDownloadComplete = (message) => {
    const transfer = activeTransfersRef.current.get(message.requestId);
    if (!transfer) return;

    console.log(`🔧 Assembling file with adaptive stats:`, message.finalStats);

    try {
      // Sort and assemble chunks
      transfer.chunks.sort((a, b) => a.index - b.index);
      const orderedData = transfer.chunks.map(chunk => chunk.data);
      
      const blob = new Blob(orderedData, { type: transfer.mimeType });
      const url = URL.createObjectURL(blob);

      const downloadedFile = {
        id: Date.now() + Math.random(),
        name: transfer.fileName,
        size: transfer.fileSize,
        type: transfer.mimeType,
        url: url,
        timestamp: new Date().toISOString(),
        downloadTime: (Date.now() - transfer.startTime) / 1000,
        avgSpeed: transfer.speed
      };

      setDownloadedFiles(prev => [...prev, downloadedFile]);
      
      // Auto-download
      const a = document.createElement('a');
      a.href = url;
      a.download = transfer.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      console.log(
        `✅ Adaptive download completed: ${transfer.fileName} | ` +
        `Time: ${formatTime(downloadedFile.downloadTime)} | ` +
        `Avg Speed: ${formatSpeed(downloadedFile.avgSpeed)}`
      );

    } catch (error) {
      console.error(`❌ Failed to assemble file: ${transfer.fileName}`, error);
    } finally {
      activeTransfersRef.current.delete(message.requestId);
      setActiveDownloads(prev => {
        const remaining = prev.filter(d => d.id !== message.requestId);
        if (remaining.length === 0) releaseWakeLock();
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
      if (remaining.length === 0) releaseWakeLock();
      return remaining;
    });
    alert(`Download failed: ${message.error}`);
  };

  // Send ping with timestamp
  const sendPing = () => {
    if (peerRef.current && peerRef.current.connected) {
      const timestamp = Date.now();
      peerRef.current.send(JSON.stringify({ type: 'ping', timestamp }));
    }
  };

  const sendPong = () => {
    if (peerRef.current && peerRef.current.connected) {
      peerRef.current.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  };

  // Create peer connection with optimized settings
  const createPeer = useCallback((initiator, roomId) => {
    console.log('🔗 Creating adaptive peer connection, initiator:', initiator);
    
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      },
      channelConfig: {
        maxRetransmits: 10,
        ordered: true
      },
      sdpTransform: (sdp) => {
        // Set conservative bandwidth limits for stability
        let modifiedSdp = sdp.replace(/b=AS:30/g, 'b=AS:2000'); // 2 Mbps - very conservative
        modifiedSdp = modifiedSdp.replace(/b=CT:1000/g, 'b=CT:2000'); // Conference total
        return modifiedSdp;
      }
    });

    peer.on('signal', (data) => {
      socket.emit('signal', { roomId, signal: data });
    });

    peer.on('connect', () => {
      console.log('✅ Adaptive peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      peer.on('data', handlePeerMessage);
      
      // Initial connection test and sync
      setTimeout(() => {
        sendPing();
        sendMyFilesList();
        
        // Check for paused transfers to resume
        const control = rateControlRef.current;
        if (control.resumeTransfers.size > 0) {
          console.log(`🔄 Found ${control.resumeTransfers.size} paused transfers, asking user for resume...`);
          resumePausedTransfers();
        }
        
        // Start periodic RTT measurements
        setInterval(() => {
          if (peer.connected) sendPing();
        }, 10000);
      }, 2000); // Longer delay to ensure connection is stable
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error:', err);
      
      // Handle different error types
      if (err.message?.includes('User-Initiated Abort')) {
        setStatus('mobile-disconnected');
        console.warn('📱 Mobile browser backgrounded - connection lost');
      } else if (err.message?.includes('destroyed')) {
        setStatus('disconnected');
        console.warn('🔌 Peer was destroyed');
      } else {
        setStatus('disconnected');
      }
      
      setIsConnected(false);
      
      // Clean up transfers on critical errors
      if (activeTransfersRef.current.size > 0) {
        console.log('🧹 Cleaning up active transfers due to peer error');
        activeTransfersRef.current.clear();
        setActiveDownloads([]);
      }
    });

    peer.on('close', () => {
      console.log('🔌 Peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
      setAvailableFiles([]);
      setActiveDownloads([]);
      activeTransfersRef.current.clear();
    });

    peerRef.current = peer;
    return peer;
  }, [socket, handlePeerMessage]);

  // Share files with metadata
  const shareFiles = useCallback((files) => {
    const fileArray = Array.isArray(files) ? files : [files];
    console.log(`📋 Sharing ${fileArray.length} file(s)`);

    fileArray.forEach(file => {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      fileRefsMap.current.set(fileId, file);
      
      const sharedFile = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: new Date().toISOString(),
        file: file
      };
      
      setMySharedFiles(prev => [...prev, sharedFile]);
      
      if (isConnected && peerRef.current?.connected) {
        peerRef.current.send(JSON.stringify({
          type: 'file-metadata',
          fileId: fileId,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          timestamp: sharedFile.timestamp,
          peerId: 'me'
        }));
      }
    });
  }, [isConnected]);

  // Request download with adaptive control
  const requestDownload = useCallback((fileInfo) => {
    if (!isConnected) {
      console.warn('Not connected to peer');
      return;
    }

    const requestId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`📥 Requesting adaptive download: ${fileInfo.name}`);
    
    peerRef.current.send(JSON.stringify({
      type: 'download-request',
      requestId: requestId,
      fileId: fileInfo.id,
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      adaptive: true
    }));
  }, [isConnected]);

  // Send file list to peer
  const sendMyFilesList = () => {
    if (!peerRef.current?.connected) return;
    
    console.log(`📤 Sending file list: ${mySharedFiles.length} files`);
    
    mySharedFiles.forEach(file => {
      peerRef.current.send(JSON.stringify({
        type: 'file-metadata',
        fileId: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        timestamp: file.timestamp,
        peerId: 'me'
      }));
    });
  };

  // Refresh available files
  const refreshAvailableFiles = useCallback(() => {
    if (peerRef.current?.connected) {
      peerRef.current.send(JSON.stringify({ type: 'files-list-request' }));
      sendPing();
    }
  }, []);

  // Resume paused transfers
  const resumePausedTransfers = async () => {
    const control = rateControlRef.current;
    
    if (control.resumeTransfers.size === 0) return;
    
    console.log('🔄 Attempting to resume paused transfers...');
    
    for (const [transferId, transferState] of control.resumeTransfers.entries()) {
      try {
        // Ask user if they want to resume
        const resume = confirm(
          `Resume upload of "${transferState.file.name}" from ${((transferState.bytesTransferred / transferState.file.size) * 100).toFixed(1)}%?`
        );
        
        if (resume) {
          console.log(`🔄 Resuming transfer: ${transferState.file.name} from ${transferState.bytesTransferred} bytes`);
          
          // Update UI to show resuming
          setActiveDownloads(prev => prev.map(d => 
            d.id === transferId 
              ? { ...d, status: 'resuming' }
              : d
          ));
          
          // Resume from where we left off
          await resumeFileUpload(transferState);
          
        } else {
          console.log(`❌ User cancelled resume for: ${transferState.file.name}`);
          // Remove from UI
          setActiveDownloads(prev => prev.filter(d => d.id !== transferId));
        }
        
        // Clear from resume map
        control.resumeTransfers.delete(transferId);
        
      } catch (error) {
        console.error(`Failed to resume transfer ${transferId}:`, error);
        control.resumeTransfers.delete(transferId);
        setActiveDownloads(prev => prev.filter(d => d.id !== transferId));
      }
    }
  };

  // Resume individual file upload from saved state
  const resumeFileUpload = async (transferState) => {
    const { file, request, offset: startOffset, chunkIndex: startChunk, totalChunks, startTime } = transferState;
    const transferId = request.requestId;
    const control = rateControlRef.current;
    
    console.log(`🚀 Resuming upload from chunk ${startChunk}/${totalChunks}`);
    
    try {
      // Send resume signal to peer
      peerRef.current.send(JSON.stringify({
        type: 'download-resume',
        requestId: transferId,
        resumeOffset: startOffset,
        resumeChunk: startChunk
      }));
      
      // Continue upload from where we left off
      let offset = startOffset;
      let chunkIndex = startChunk;
      
      while (offset < file.size) {
        if (!peerRef.current || !peerRef.current.connected) {
          throw new Error('Connection lost again during resume');
        }
        
        const currentChunkSize = calculateAdaptiveChunkSize();
        const chunkEndOffset = Math.min(offset + currentChunkSize, file.size);
        const actualChunkSize = chunkEndOffset - offset;
        
        const chunk = await readFileChunk(file, offset, actualChunkSize);
        
        // Send chunk
        peerRef.current.send(JSON.stringify({
          type: 'file-chunk-header',
          transferId: transferId,
          chunkIndex: chunkIndex,
          chunkSize: chunk.byteLength,
          offset: offset,
          isLast: chunkEndOffset >= file.size,
          resumed: true
        }));
        
        await delay(calculateAdaptiveDelay());
        peerRef.current.send(chunk);
        
        offset = chunkEndOffset;
        chunkIndex++;
        
        // Update progress
        const progress = (offset / file.size) * 100;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = offset / elapsed;
        
        setActiveDownloads(prev => prev.map(d => 
          d.id === transferId 
            ? { ...d, progress, speed, status: 'uploading' }
            : d
        ));
        
        if (chunkIndex % 100 === 0) {
          console.log(`📤 Resume progress: ${progress.toFixed(1)}%`);
        }
      }
      
      // Send completion
      peerRef.current.send(JSON.stringify({
        type: 'download-complete',
        requestId: transferId,
        resumed: true
      }));
      
      console.log(`✅ Resumed upload completed: ${file.name}`);
      
      // Clean up
      setActiveDownloads(prev => prev.filter(d => d.id !== transferId));
      
    } catch (error) {
      console.error(`❌ Resume failed: ${file.name}`, error);
      setActiveDownloads(prev => prev.filter(d => d.id !== transferId));
      throw error;
    }
  };

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

  const waitForBuffer = (peer, threshold = BUFFER_HIGH_THRESHOLD) => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 200; // More attempts but faster checks
      
      const checkBuffer = () => {
        if (!peer?.connected) {
          reject(new Error('Peer disconnected'));
          return;
        }
        
        const bufferAmount = peer.bufferedAmount || 0;
        
        if (bufferAmount < threshold) {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('Buffer timeout'));
        } else {
          attempts++;
          setTimeout(checkBuffer, 10); // Check every 10ms instead of 50ms
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

  // Wake lock management
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('📱 Wake lock acquired');
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
        console.log('📱 Wake lock released');
      } catch (err) {
        console.warn('⚠️ Wake lock release failed:', err);
      }
    }
  };

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    const handleRoomCreated = ({ roomId }) => {
      setRoomId(roomId);
      setStatus('waiting');
    };

    const handleRoomJoined = ({ roomId }) => {
      setRoomId(roomId);
      createPeer(true, roomId);
      setStatus('waiting');
    };

    const handlePeerJoined = () => {
      if (!peerRef.current) {
        createPeer(false, roomId);
      }
    };

    const handleSignal = ({ signal }) => {
      if (peerRef.current) {
        peerRef.current.signal(signal);
      }
    };

    const handlePeerLeft = () => {
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      setIsConnected(false);
      setStatus('waiting');
      setAvailableFiles([]);
    };

    const handleRoomError = ({ message }) => {
      console.error('Room error:', message);
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
      socket.emit('create-room');
    }
  }, [socket]);

  const joinRoom = useCallback((roomCode) => {
    if (socket && roomCode) {
      socket.emit('join-room', roomCode);
    }
  }, [socket]);

  return {
    roomId,
    isConnected,
    status,
    availableFiles,
    mySharedFiles,
    downloadedFiles,
    activeDownloads,
    shareFiles,
    requestDownload,
    refreshAvailableFiles,
    sendPing,
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed,
    formatTime,
    // Expose adaptive control info
    getAdaptiveInfo: () => ({
      uploadRate: rateControlRef.current.uploadRate,
      downloadRate: rateControlRef.current.downloadRate,
      rtt: rateControlRef.current.rtt,
      chunkSize: rateControlRef.current.currentChunkSize,
      congestionLevel: rateControlRef.current.congestionLevel,
      bufferPressure: rateControlRef.current.bufferPressure
    })
  };
};