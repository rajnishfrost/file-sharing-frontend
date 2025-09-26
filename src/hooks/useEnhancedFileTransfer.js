import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import EnhancedFileTransfer from '../utils/EnhancedFileTransfer';
import EnhancedFileReceiver from '../utils/EnhancedFileReceiver';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const useEnhancedFileTransfer = () => {
  // Connection state
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('disconnected'); // disconnected, waiting, connected, transferring
  
  // Transfer state
  const [transfers, setTransfers] = useState([]);
  const [currentTransfer, setCurrentTransfer] = useState(null);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const [sharedFiles, setSharedFiles] = useState([]);
  
  // Refs
  const peerRef = useRef(null);
  const transferRef = useRef(null);
  const receiverRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to signaling server');
    });
    
    setSocket(newSocket);
    
    return () => {
      cleanup();
      newSocket.close();
    };
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (transferRef.current) {
      transferRef.current.destroy();
      transferRef.current = null;
    }
    if (receiverRef.current) {
      receiverRef.current.destroy();
      receiverRef.current = null;
    }
  }, []);

  // Create peer connection
  const createPeer = useCallback((initiator, roomId) => {
    console.log('Creating peer connection, initiator:', initiator);
    
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

    peer.on('connect', async () => {
      console.log('✅ Peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      // Initialize enhanced file transfer system
      transferRef.current = new EnhancedFileTransfer(peer, {
        chunkSize: 256 * 1024, // 256KB chunks
        parallelStreams: 4,
        compressionThreshold: 1024 * 1024, // Compress files > 1MB
        resumeEnabled: true,
        checksumEnabled: true,
        adaptiveBitrate: true
      });

      // Set up transfer callbacks
      transferRef.current.callbacks.onProgress = (progressData) => {
        setCurrentTransfer(prev => ({
          ...prev,
          ...progressData
        }));
      };

      transferRef.current.callbacks.onSpeed = (speed) => {
        setTransferSpeed(speed);
      };

      transferRef.current.callbacks.onComplete = (transfer) => {
        console.log('✅ Transfer completed:', transfer.id);
        setCurrentTransfer(null);
        setStatus('connected');
        
        // Add files to shared list
        if (transfer.files) {
          const newFiles = transfer.files.map(file => ({
            id: Date.now() + Math.random(),
            name: file.name,
            size: file.size,
            type: file.type,
            url: URL.createObjectURL(file),
            timestamp: new Date().toISOString(),
            isOwn: true
          }));
          setSharedFiles(prev => [...prev, ...newFiles]);
        }
      };

      transferRef.current.callbacks.onError = (error) => {
        console.error('❌ Transfer error:', error);
        setStatus('connected');
        alert(`Transfer error: ${error.error.message}. ${error.canResume ? 'Transfer can be resumed.' : ''}`);
      };

      // Initialize receiver
      receiverRef.current = new EnhancedFileReceiver(peer, {
        autoAccept: true, // Auto-accept for demo, you might want to prompt user
        verifyChecksum: true,
        storageType: 'memory', // Use 'filesystem' for very large files
        autoDownload: false,
        maxMemoryUsage: 500 * 1024 * 1024 // 500MB
      });

      // Set up receiver callbacks
      receiverRef.current.callbacks.onTransferRequest = async (manifest) => {
        console.log('📨 Incoming transfer request:', manifest);
        
        // You could show a dialog here to accept/reject
        const accepted = confirm(`Accept file transfer?\n${manifest.files.map(f => `${f.name} (${formatSize(f.size)})`).join('\n')}`);
        return accepted;
      };

      receiverRef.current.callbacks.onProgress = (progressData) => {
        setCurrentTransfer(prev => ({
          ...prev,
          ...progressData,
          isReceiving: true
        }));
      };

      receiverRef.current.callbacks.onFileComplete = (data) => {
        console.log('📁 File received:', data.file.name);
        
        // Add to shared files
        setSharedFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          ...data.file,
          timestamp: new Date().toISOString(),
          isOwn: false
        }]);
      };

      receiverRef.current.callbacks.onTransferComplete = (data) => {
        console.log('✅ Transfer received:', data);
        setCurrentTransfer(null);
        setStatus('connected');
      };

      receiverRef.current.callbacks.onError = (error) => {
        console.error('❌ Receive error:', error);
        alert(`Failed to receive files: ${error.message}`);
      };

      // Initialize channels
      await transferRef.current.initializeChannels();
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setIsConnected(false);
      setStatus('disconnected');
      cleanup();
    });

    peer.on('close', () => {
      console.log('Peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
      cleanup();
    });

    peerRef.current = peer;
    return peer;
  }, [socket, cleanup]);

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
      cleanup();
      setIsConnected(false);
      setStatus('waiting');
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
  }, [socket, roomId, createPeer, cleanup]);

  // Public methods
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

  // Send files (single or multiple)
  const sendFiles = useCallback(async (files) => {
    if (!transferRef.current || !isConnected) {
      alert('Not connected to peer');
      return;
    }

    if (!files || files.length === 0) {
      alert('Please select files to send');
      return;
    }

    setStatus('transferring');
    
    try {
      const transferId = await transferRef.current.sendFiles(files);
      console.log('📤 Transfer started:', transferId);
      
      // Track transfer
      setTransfers(prev => [...prev, {
        id: transferId,
        type: 'send',
        files: Array.from(files).map(f => ({ name: f.name, size: f.size })),
        startTime: Date.now(),
        status: 'active'
      }]);
      
    } catch (error) {
      console.error('Failed to start transfer:', error);
      alert(`Failed to start transfer: ${error.message}`);
      setStatus('connected');
    }
  }, [isConnected]);

  // Pause transfer
  const pauseTransfer = useCallback((transferId) => {
    if (transferRef.current) {
      transferRef.current.pauseTransfer(transferId || currentTransfer?.transferId);
    }
  }, [currentTransfer]);

  // Resume transfer
  const resumeTransfer = useCallback((transferId) => {
    if (transferRef.current) {
      transferRef.current.resumeTransfer(transferId || currentTransfer?.transferId);
    }
  }, [currentTransfer]);

  // Cancel transfer
  const cancelTransfer = useCallback((transferId) => {
    if (transferRef.current) {
      transferRef.current.cancelTransfer(transferId || currentTransfer?.transferId);
      setCurrentTransfer(null);
      setStatus('connected');
    }
  }, [currentTransfer]);

  // Download file
  const downloadFile = useCallback((file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.click();
  }, []);

  // Clear shared files
  const clearSharedFiles = useCallback(() => {
    sharedFiles.forEach(file => {
      if (file.url) {
        URL.revokeObjectURL(file.url);
      }
    });
    setSharedFiles([]);
  }, [sharedFiles]);

  // Utility function
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

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  return {
    // Connection state
    roomId,
    isConnected,
    status,
    
    // Transfer state
    currentTransfer,
    transfers,
    transferSpeed,
    sharedFiles,
    
    // Actions
    createRoom,
    joinRoom,
    sendFiles,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    downloadFile,
    clearSharedFiles,
    
    // Utilities
    formatSize,
    formatSpeed,
    formatTime
  };
};