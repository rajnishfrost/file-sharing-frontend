import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import FixedLargeFileTransfer from '../utils/FixedLargeFileTransfer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const LARGE_FILE_THRESHOLD = 256 * 1024; // 256KB - use fixed transfer for all files

export const useOneToOne = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [status, setStatus] = useState('disconnected'); // disconnected, waiting, connected, transferring
  
  const peerRef = useRef(null);
  const fileQueueRef = useRef([]);
  const receivingFileRef = useRef(null);
  const fixedTransferRef = useRef(null);
  const isProcessingQueue = useRef(false);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.close();
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  // Removed legacy file handling - now handled by FixedLargeFileTransfer

  // Create peer connection
  const createPeer = useCallback((initiator, roomId) => {
    console.log('Creating peer connection, initiator:', initiator);
    
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
      console.log('Peer connected!');
      setIsConnected(true);
      setStatus('connected');
      
      // Initialize fixed file transfer with callbacks
      fixedTransferRef.current = new FixedLargeFileTransfer(peer);
      
      // Set up fixed file transfer callbacks
      fixedTransferRef.current.onProgress = (progress, sent, total) => {
        setTransferProgress(progress);
      };
      
      fixedTransferRef.current.onComplete = (fileInfo) => {
        setTransferProgress(0);
        setStatus('connected');
      };
      
      fixedTransferRef.current.onFileReceived = (fileInfo) => {
        // Received file completed
        const receivedFile = {
          id: Date.now(),
          name: fileInfo.name,
          size: fileInfo.size,
          type: fileInfo.type,
          url: fileInfo.url,
          timestamp: new Date().toISOString(),
          isOwn: false
        };
        setSharedFiles(prev => [...prev, receivedFile]);
        console.log('📁 File received and added to shared files');
      };
      
      fixedTransferRef.current.onError = (error) => {
        console.error('❌ File transfer error:', error);
        setStatus('connected');
        setTransferProgress(0);
      };
      
      // Process any queued files
      processFileQueue();
    });


    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setIsConnected(false);
      setStatus('disconnected');
    });

    peer.on('close', () => {
      console.log('Peer disconnected');
      setIsConnected(false);
      setStatus('disconnected');
      
      // Cleanup fixed file transfer
      if (fixedTransferRef.current) {
        fixedTransferRef.current.destroy();
        fixedTransferRef.current = null;
      }
    });

    peerRef.current = peer;
    return peer;
  }, [socket]);

  // Process file queue
  const processFileQueue = async () => {
    if (isProcessingQueue.current || fileQueueRef.current.length === 0) {
      return;
    }

    isProcessingQueue.current = true;
    
    while (fileQueueRef.current.length > 0) {
      const file = fileQueueRef.current.shift();
      await sendFileToPeer(file);
    }
    
    isProcessingQueue.current = false;
  };

  // Send file to peer - always use fixed transfer for stability
  const sendFileToPeer = async (file, peer = peerRef.current) => {
    if (!peer || !peer.connected) {
      console.log('⚠️ Peer not connected, queueing file for later');
      fileQueueRef.current.push(file);
      return;
    }

    if (!fixedTransferRef.current) {
      console.log('⚠️ File transfer not initialized, queueing file');
      fileQueueRef.current.push(file);
      return;
    }

    console.log('📤 Starting to send file:', file.name, `${file.size} bytes`);
    setStatus('transferring');

    try {
      await fixedTransferRef.current.sendFile(
        file,
        // Progress callback
        (progress, sent, total) => {
          setTransferProgress(progress);
        },
        // Complete callback
        () => {
          console.log('✅ File transfer completed');
          
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
          setTransferProgress(0);
          setStatus('connected');
          
          // Process next file in queue
          processFileQueue();
        },
        // Error callback
        (error) => {
          console.error('❌ File transfer failed:', error);
          setStatus('connected');
          setTransferProgress(0);
        }
      );
    } catch (error) {
      console.error('❌ Failed to start file transfer:', error);
      setStatus('connected');
      setTransferProgress(0);
    }
  };

  // Removed legacy small file transfer - now using FixedLargeFileTransfer for all files

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
    };

    const handleRoomError = ({ message }) => {
      alert(message);
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
      socket.emit('create-room');
    }
  }, [socket]);

  const joinRoom = useCallback((roomCode) => {
    if (socket && roomCode) {
      socket.emit('join-room', roomCode);
    }
  }, [socket]);

  const sendFile = useCallback((file) => {
    if (file) {
      if (Array.isArray(file)) {
        // Multiple files
        file.forEach(f => fileQueueRef.current.push(f));
        processFileQueue();
      } else {
        // Single file
        fileQueueRef.current.push(file);
        processFileQueue();
      }
    }
  }, []);

  const downloadFile = useCallback((file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.click();
  }, []);

  return {
    roomId,
    isConnected,
    transferProgress,
    sharedFiles,
    status,
    peer: peerRef.current,
    createRoom,
    joinRoom,
    sendFile,
    downloadFile
  };
};