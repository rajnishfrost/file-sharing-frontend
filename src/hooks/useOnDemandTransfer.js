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
    console.log('📨 Received control message:', message.type);

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
        sendMyFilesList();
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
        return prev.map(f => f.id === fileInfo.id ? fileInfo : f);
      }
      return [...prev, fileInfo];
    });
  };

  // Handle download request from peer
  const handleDownloadRequest = async (request) => {
    console.log(`📤 Peer requested download: ${request.fileName} (ID: ${request.fileId})`);
    
    const fileRef = fileRefsMap.current.get(request.fileId);
    if (!fileRef) {
      // Send error
      peerRef.current.send(JSON.stringify({
        type: 'download-error',
        requestId: request.requestId,
        error: 'File not found'
      }));
      return;
    }

    // Start sending the file
    await startFileUpload(fileRef, request);
  };

  // Start uploading file to peer
  const startFileUpload = async (file, request) => {
    const transferId = request.requestId;
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
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
        startTime: Date.now()
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

        await delay(5);

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

        await delay(1); // Small delay between chunks
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
      
      // Request peer's file list
      setTimeout(() => {
        peer.send(JSON.stringify({ type: 'files-list-request' }));
      }, 500);
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
      console.warn('Not connected to peer');
      return;
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
      
      // Send metadata to peer
      peerRef.current.send(JSON.stringify({
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        timestamp: sharedFile.timestamp,
        peerId: 'me'
      }));
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
    availableFiles,      // Files peer is sharing (can download)
    mySharedFiles,       // Files I'm sharing
    downloadedFiles,     // Files I've downloaded
    activeDownloads,     // Current transfers
    shareFiles,          // Share files (metadata only)
    requestDownload,     // Start downloading a file
    createRoom,
    joinRoom,
    formatSize,
    formatSpeed,
    formatTime
  };
};