import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

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

  // Handle incoming messages
  const handlePeerMessage = useCallback((data) => {
    try {
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        console.log('📨 Received control message:', message.type, message);
        console.log('📨 Full message content:', JSON.stringify(message, null, 2));
        handleControlMessage(message);
      } else {
        // Binary data - file chunk
        handleFileChunk(data);
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
      case 'files-list-request':
        console.log('📋 Peer requested file list, sending my shared files...');
        sendMyFilesList();
        break;
      case 'files-list-response':
        console.log('📋 Received peer\'s file list');
        handleFilesList(message);
        break;
      case 'sync-request':
        console.log('🔄 Peer requested sync, exchanging file lists...');
        sendMyFilesList();
        requestPeerFilesList();
        break;
    }
  };

  // Handle file metadata from peer (they're sharing a file)
  const handleFileMetadata = (metadata) => {
    console.log(`📋 Peer is sharing: ${metadata.name} (${formatSize(metadata.size)})`);
    console.log('📋 Full metadata received:', JSON.stringify(metadata, null, 2));
    
    const fileInfo = {
      id: metadata.fileId,
      name: metadata.name,
      size: metadata.size,
      type: metadata.mimeType,
      timestamp: metadata.timestamp,
      isAvailable: true,
      peerId: metadata.peerId || 'peer'
    };
    
    console.log('📋 Created fileInfo object:', JSON.stringify(fileInfo, null, 2));

    setAvailableFiles(prev => {
      console.log('📋 Current availableFiles count:', prev.length);
      console.log('📋 Current availableFiles:', prev);
      const existing = prev.find(f => f.id === fileInfo.id);
      if (existing) {
        console.log(`📁 Updating existing file: ${fileInfo.name}`);
        const updated = prev.map(f => f.id === fileInfo.id ? fileInfo : f);
        console.log('📁 Updated availableFiles:', updated);
        return updated;
      }
      console.log(`📁 Adding new file to available files: ${fileInfo.name}`);
      const updated = [...prev, fileInfo];
      console.log('📁 New availableFiles array:', updated);
      return updated;
    });
  };

  // Handle files list from peer
  const handleFilesList = (message) => {
    console.log('📋 Processing peer file list:', message.files);
    if (message.files && Array.isArray(message.files)) {
      setAvailableFiles(message.files.map(file => ({
        ...file,
        isAvailable: true,
        peerId: 'peer'
      })));
    }
  };

  // Handle download request from peer
  const handleDownloadRequest = async (request) => {
    console.log(`📤 Peer requested download: ${request.fileName} (ID: ${request.fileId})`);
    
    const fileRef = fileRefsMap.current.get(request.fileId);
    if (!fileRef) {
      console.error(`❌ File not found: ${request.fileId}`);
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
    const CHUNK_SIZE = 32 * 1024; // 32KB chunks for better stability
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

      // Stream file chunks
      let offset = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check if peer is still connected
        if (!peerRef.current || !peerRef.current.connected) {
          throw new Error('Peer disconnected during upload');
        }

        // Wait for buffer to clear
        await waitForBuffer(peerRef.current);

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

        await delay(10); // Increased delay for stability

        // Send chunk data
        peerRef.current.send(chunk);

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

        await delay(5); // Increased delay between chunks for stability
      }

      // Send completion
      peerRef.current.send(JSON.stringify({
        type: 'download-complete',
        requestId: transferId
      }));

      console.log(`✅ Upload completed: ${file.name}`);

      // Remove from active downloads
      setActiveDownloads(prev => prev.filter(d => d.id !== transferId));

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

      setActiveDownloads(prev => prev.filter(d => d.id !== transferId));
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
      // Assemble chunks
      const orderedChunks = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        if (!transfer.chunks[i]) {
          throw new Error(`Missing chunk ${i}`);
        }
        orderedChunks.push(transfer.chunks[i]);
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
      setActiveDownloads(prev => prev.filter(d => d.id !== message.requestId));
    }
  };

  // Handle download error
  const handleDownloadError = (message) => {
    console.error(`❌ Download error: ${message.error}`);
    activeTransfersRef.current.delete(message.requestId);
    setActiveDownloads(prev => prev.filter(d => d.id !== message.requestId));
    alert(`Download failed: ${message.error}`);
  };

  // Create peer connection
  const createPeer = useCallback((initiator, roomId) => {
    console.log('🔗 Creating on-demand peer connection');
    
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (data) => {
      socket.emit('signal', { roomId, signal: data });
    });

    peer.on('connect', () => {
      console.log('✅ On-demand peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      peer.on('data', handlePeerMessage);
      
      // Give a moment for connection to stabilize, then sync
      setTimeout(() => {
        console.log('🔄 Initiating file list sync...');
        peer.send(JSON.stringify({ type: 'sync-request' }));
      }, 1000);
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error:', err);
      setIsConnected(false);
      setStatus('disconnected');
    });

    peer.on('close', () => {
      console.log('🔌 Peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
      setAvailableFiles([]); // Clear available files when peer disconnects
    });

    peerRef.current = peer;
    return peer;
  }, [socket, handlePeerMessage]);

  // Share files (metadata only)
  const shareFiles = useCallback((files) => {
    if (!isConnected) {
      console.warn('⚠️ Not connected to peer, files will be shared when connected');
    }

    const fileArray = Array.isArray(files) ? files : [files];
    console.log(`📋 Sharing metadata for ${fileArray.length} file(s)`);

    fileArray.forEach(file => {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
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
      
      setMySharedFiles(prev => [...prev, sharedFile]);
      
      // Send metadata to peer if connected
      if (isConnected && peerRef.current && peerRef.current.connected) {
        console.log(`📤 Sending metadata for: ${file.name}`);
        try {
          peerRef.current.send(JSON.stringify({
            type: 'file-metadata',
            fileId: fileId,
            name: file.name,
            size: file.size,
            mimeType: file.type,
            timestamp: sharedFile.timestamp,
            peerId: 'me'
          }));
        } catch (error) {
          console.error('Failed to send file metadata:', error);
        }
      } else {
        console.log(`⏳ Will send metadata for ${file.name} when peer connects...`);
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

  // Send my files list to peer
  const sendMyFilesList = () => {
    if (!peerRef.current || !peerRef.current.connected) {
      console.log('❌ Cannot send file list - peer not connected');
      return;
    }
    
    console.log(`📤 Sending my file list: ${mySharedFiles.length} files`);
    console.log('Files to send:', mySharedFiles.map(f => ({ name: f.name, size: f.size })));
    
    // Send individual metadata for each file
    mySharedFiles.forEach((file, index) => {
      try {
        console.log(`📤 Sending metadata ${index + 1}/${mySharedFiles.length}: ${file.name}`);
        peerRef.current.send(JSON.stringify({
          type: 'file-metadata',
          fileId: file.id,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          timestamp: file.timestamp,
          peerId: 'me'
        }));
      } catch (error) {
        console.error(`Failed to send metadata for ${file.name}:`, error);
      }
    });

    // Also send as a list
    peerRef.current.send(JSON.stringify({
      type: 'files-list-response',
      files: mySharedFiles.map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: file.timestamp
      }))
    }));
  };

  // Request peer's files list
  const requestPeerFilesList = () => {
    if (peerRef.current && peerRef.current.connected) {
      console.log('📥 Requesting peer file list...');
      peerRef.current.send(JSON.stringify({ type: 'files-list-request' }));
    }
  };

  // Refresh available files (public method)
  const refreshAvailableFiles = useCallback(() => {
    console.log('🔄 Refreshing available files...');
    if (peerRef.current && peerRef.current.connected) {
      console.log('🔄 Requesting peer files and sending our files...');
      try {
        requestPeerFilesList();
        // Also send our files to peer
        sendMyFilesList();
      } catch (error) {
        console.error('Failed to refresh files:', error);
      }
    } else {
      console.log('⚠️ Cannot refresh - peer not connected');
    }
  }, []);

  // When files are shared, automatically send to connected peer
  useEffect(() => {
    if (isConnected && mySharedFiles.length > 0) {
      // Small delay to ensure connection is stable
      setTimeout(() => {
        console.log('🔄 Auto-sending file list to connected peer...');
        sendMyFilesList();
      }, 500);
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

  const waitForBuffer = (peer, threshold = 128 * 1024) => {
    return new Promise(resolve => {
      const checkBuffer = () => {
        const bufferAmount = peer.bufferedAmount || 0;
        if (bufferAmount < threshold) {
          resolve();
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

  // Socket event handlers (same as before)
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
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed,
    formatTime
  };
};