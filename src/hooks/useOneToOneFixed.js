import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const useOneToOne = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [status, setStatus] = useState('disconnected');
  
  const peerRef = useRef(null);
  const fileQueueRef = useRef([]);
  const receivingFileRef = useRef(null);
  const isTransferringRef = useRef(false);

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

  // Handle incoming file data
  const handleFileData = useCallback((data) => {
    try {
      console.log('📨 Received data:', typeof data, data instanceof ArrayBuffer ? `ArrayBuffer (${data.byteLength} bytes)` : 'String/Other');
      
      // Check if it's metadata (JSON string)
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);
          handleMetadata(message);
          return;
        } catch (e) {
          console.warn('Failed to parse string as JSON:', e);
          return;
        }
      }
      
      // Check if it's binary metadata
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        try {
          const text = new TextDecoder().decode(data);
          if (text.startsWith('{') && text.endsWith('}')) {
            const message = JSON.parse(text);
            handleMetadata(message);
            return;
          }
        } catch (e) {
          // It's actual file chunk data
          handleFileChunk(data);
        }
      }
    } catch (error) {
      console.error('❌ Error handling file data:', error);
    }
  }, []);

  const handleMetadata = (message) => {
    console.log('📋 Received metadata:', message.type);
    
    if (message.type === 'file-start') {
      console.log(`📥 Starting to receive: ${message.name} (${formatSize(message.size)})`);
      receivingFileRef.current = {
        name: message.name,
        size: message.size,
        type: message.mimeType || message.fileType || 'application/octet-stream',
        chunks: [],
        receivedBytes: 0,
        totalChunks: message.totalChunks || Math.ceil(message.size / 16384), // 16KB chunks
        receivedChunks: 0
      };
      setTransferProgress(0);
      setStatus('transferring');
      
    } else if (message.type === 'file-end') {
      console.log('✅ File transfer complete, assembling...');
      assembleReceivedFile();
      
    } else if (message.type === 'chunk-info') {
      // Store chunk info for next binary data
      if (receivingFileRef.current) {
        receivingFileRef.current.nextChunkInfo = message;
      }
    }
  };

  const handleFileChunk = (chunkData) => {
    if (!receivingFileRef.current) {
      console.warn('⚠️ Received chunk but no active transfer');
      return;
    }

    const transfer = receivingFileRef.current;
    transfer.chunks.push(chunkData);
    transfer.receivedChunks++;
    transfer.receivedBytes += chunkData.byteLength || chunkData.length;

    const progress = (transfer.receivedChunks / transfer.totalChunks) * 100;
    setTransferProgress(progress);
    
    console.log(`📦 Received chunk ${transfer.receivedChunks}/${transfer.totalChunks} (${progress.toFixed(1)}%)`);
  };

  const assembleReceivedFile = () => {
    if (!receivingFileRef.current) return;

    const transfer = receivingFileRef.current;
    console.log(`🔧 Assembling ${transfer.name} from ${transfer.chunks.length} chunks`);

    try {
      const blob = new Blob(transfer.chunks, { type: transfer.type });
      const url = URL.createObjectURL(blob);
      
      const fileInfo = {
        id: Date.now() + Math.random(),
        name: transfer.name,
        size: transfer.size,
        type: transfer.type,
        url: url,
        timestamp: new Date().toISOString(),
        isOwn: false
      };

      setSharedFiles(prev => [...prev, fileInfo]);
      console.log('📁 File assembled and added to shared files:', fileInfo.name);
      
      receivingFileRef.current = null;
      setTransferProgress(0);
      setStatus('connected');
      
    } catch (error) {
      console.error('❌ Failed to assemble file:', error);
      setStatus('connected');
    }
  };

  // Create peer connection
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
      }
    });

    peer.on('signal', (data) => {
      socket.emit('signal', { roomId, signal: data });
    });

    peer.on('connect', () => {
      console.log('✅ Peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      // Set up data handler
      peer.on('data', handleFileData);
      
      // Process any queued files
      processQueue();
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
    });

    peerRef.current = peer;
    return peer;
  }, [socket, handleFileData]);

  // Process file queue
  const processQueue = useCallback(async () => {
    if (isTransferringRef.current || fileQueueRef.current.length === 0) {
      return;
    }

    while (fileQueueRef.current.length > 0) {
      const file = fileQueueRef.current.shift();
      await sendFileToPeer(file);
    }
  }, []);

  // Send file to peer with simple chunking
  const sendFileToPeer = async (file) => {
    if (!peerRef.current || !peerRef.current.connected) {
      console.log('⚠️ Peer not connected, queueing file');
      fileQueueRef.current.unshift(file); // Put back at front
      return;
    }

    if (isTransferringRef.current) {
      console.log('⚠️ Transfer in progress, queueing file');
      fileQueueRef.current.unshift(file);
      return;
    }

    isTransferringRef.current = true;
    console.log(`📤 Starting to send: ${file.name} (${formatSize(file.size)})`);
    setStatus('transferring');

    try {
      const CHUNK_SIZE = 16 * 1024; // 16KB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Send metadata
      const metadata = {
        type: 'file-start',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks: totalChunks
      };

      console.log('📋 Sending metadata:', metadata);
      peerRef.current.send(JSON.stringify(metadata));
      
      // Wait a bit for metadata to be processed
      await delay(100);

      // Read and send file in chunks
      let offset = 0;
      let chunkIndex = 0;

      while (offset < file.size) {
        const chunk = await readFileChunk(file, offset, CHUNK_SIZE);
        
        // Check buffer pressure before sending
        await waitForBuffer(peerRef.current);
        
        // Send chunk
        peerRef.current.send(chunk);
        
        offset += chunk.byteLength;
        chunkIndex++;
        
        const progress = (offset / file.size) * 100;
        setTransferProgress(progress);
        
        console.log(`📦 Sent chunk ${chunkIndex}/${totalChunks} (${progress.toFixed(1)}%)`);
        
        // Small delay to prevent overwhelming
        await delay(10);
      }

      // Send completion signal
      peerRef.current.send(JSON.stringify({ type: 'file-end' }));
      
      // Add to local shared files
      const url = URL.createObjectURL(file);
      const fileInfo = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        type: file.type,
        url: url,
        timestamp: new Date().toISOString(),
        isOwn: true
      };
      
      setSharedFiles(prev => [...prev, fileInfo]);
      console.log('✅ File sent successfully:', file.name);
      
    } catch (error) {
      console.error('❌ Failed to send file:', error);
    } finally {
      isTransferringRef.current = false;
      setTransferProgress(0);
      setStatus('connected');
      
      // Process next file in queue
      setTimeout(processQueue, 100);
    }
  };

  // Helper functions
  const readFileChunk = (file, offset, size) => {
    return new Promise((resolve, reject) => {
      const slice = file.slice(offset, Math.min(offset + size, file.size));
      const reader = new FileReader();
      
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      
      reader.readAsArrayBuffer(slice);
    });
  };

  const waitForBuffer = (peer) => {
    return new Promise(resolve => {
      const checkBuffer = () => {
        const bufferAmount = peer.bufferedAmount || 0;
        if (bufferAmount < 64 * 1024) { // 64KB threshold
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
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
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

  // Public methods
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

  const sendFile = useCallback((files) => {
    if (!files) return;
    
    // Handle both single file and multiple files
    const fileArray = Array.isArray(files) ? files : [files];
    
    console.log(`📁 Queueing ${fileArray.length} file(s) for transfer`);
    fileQueueRef.current.push(...fileArray);
    
    // Start processing if connected
    if (isConnected && !isTransferringRef.current) {
      processQueue();
    }
  }, [isConnected, processQueue]);

  const downloadFile = useCallback((file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return {
    roomId,
    isConnected,
    transferProgress,
    sharedFiles,
    status,
    createRoom,
    joinRoom,
    sendFile,
    downloadFile
  };
};