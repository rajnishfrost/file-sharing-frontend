import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const CHUNK_SIZE = 16384;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

const generateRandomName = () => {
  const adjectives = ['Cool', 'Smart', 'Quick', 'Bright', 'Swift', 'Bold', 'Clever', 'Happy'];
  const animals = ['Tiger', 'Eagle', 'Dolphin', 'Lion', 'Fox', 'Wolf', 'Bear', 'Hawk'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}${Math.floor(Math.random() * 99)}`;
};

export const useSimpleWebRTC = () => {
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomUsers, setRoomUsers] = useState([]);
  const [connectedPeers, setConnectedPeers] = useState([]);
  const [userName, setUserName] = useState(() => generateRandomName());
  const [sharedFiles, setSharedFiles] = useState([]);
  const [transferStatus, setTransferStatus] = useState('idle');
  const [transferProgress, setTransferProgress] = useState({});

  const peersRef = useRef(new Map());
  const fileDataRef = useRef(new Map());
  const roomIdRef = useRef('');
  const fileChunksRef = useRef(new Map()); // Store incoming file chunks

  // Enhanced file receive handler with chunked support
  const handleFileData = useCallback((senderId, data) => {
    console.log('📨 File data from:', senderId, 'Type:', typeof data);
    
    if (typeof data === 'string') {
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'file-metadata') {
          // Initialize file reception
          const fileId = `${senderId}-${message.name}-${message.timestamp}`;
          console.log('📋 Receiving file metadata:', message.name, 'chunks:', message.totalChunks);
          
          fileChunksRef.current.set(fileId, {
            metadata: message,
            chunks: new Array(message.totalChunks).fill(null),
            receivedCount: 0
          });
          
          setTransferProgress(prev => ({
            ...prev,
            [fileId]: { received: 0, total: message.totalChunks, name: message.name }
          }));
          
        } else if (message.type === 'file-chunk') {
          // Receive file chunk
          const fileId = `${senderId}-${message.fileName}-${message.timestamp}`;
          const fileData = fileChunksRef.current.get(fileId);
          
          if (fileData && fileData.chunks[message.chunkIndex] === null) {
            fileData.chunks[message.chunkIndex] = message.data;
            fileData.receivedCount++;
            
            console.log(`📦 Chunk ${message.chunkIndex + 1}/${fileData.metadata.totalChunks} received for ${message.fileName}`);
            
            setTransferProgress(prev => ({
              ...prev,
              [fileId]: { 
                received: fileData.receivedCount, 
                total: fileData.metadata.totalChunks, 
                name: message.fileName 
              }
            }));
            
            // Check if all chunks received
            if (fileData.receivedCount === fileData.metadata.totalChunks) {
              console.log('✅ All chunks received, reconstructing file:', message.fileName);
              
              // Reconstruct file
              const completeData = fileData.chunks.join('');
              const dataUrl = `data:${fileData.metadata.fileType};base64,${completeData}`;
              
              const fileInfo = {
                id: fileId,
                url: dataUrl,
                name: fileData.metadata.name,
                size: fileData.metadata.size,
                type: fileData.metadata.fileType,
                sender: fileData.metadata.senderName,
                senderId: senderId,
                timestamp: new Date().toISOString(),
                isImage: fileData.metadata.fileType.startsWith('image/'),
                isVideo: fileData.metadata.fileType.startsWith('video/')
              };
              
              setSharedFiles(prev => {
                const exists = prev.find(f => f.name === fileInfo.name && f.senderId === senderId);
                if (!exists) {
                  console.log('✅ Adding reconstructed file to shared list');
                  return [...prev, fileInfo];
                }
                return prev;
              });
              
              // Cleanup
              fileChunksRef.current.delete(fileId);
              setTransferProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[fileId];
                return newProgress;
              });
            }
          }
          
        } else if (message.type === 'file') {
          // Legacy single-message file support (for small files)
          console.log('📁 Received legacy file:', message.name, 'from', message.senderName);
          
          const fileInfo = {
            id: `${senderId}-${Date.now()}`,
            url: message.data,
            name: message.name,
            size: message.size,
            type: message.fileType,
            sender: message.senderName,
            senderId: senderId,
            timestamp: new Date().toISOString(),
            isImage: message.fileType.startsWith('image/'),
            isVideo: message.fileType.startsWith('video/')
          };
          
          setSharedFiles(prev => {
            const exists = prev.find(f => f.name === fileInfo.name && f.senderId === senderId);
            if (!exists) {
              console.log('✅ Adding file to shared list');
              return [...prev, fileInfo];
            }
            return prev;
          });
          
        } else if (message.type === 'test') {
          console.log('🧪 Test message from:', senderId, '-', message.message);
        }
      } catch (e) {
        console.log('Failed to parse message:', e);
      }
    }
  }, []);

  // Create peer connection
  const createPeer = useCallback((targetId, initiator) => {
    console.log(`🔗 Creating peer connection: ${socketId} ${initiator ? '→' : '←'} ${targetId}`);
    
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (data) => {
      console.log('📡 Sending signal to:', targetId);
      socket.emit('signal', {
        roomId,
        targetId,
        signal: data
      });
    });

    peer.on('connect', () => {
      console.log('✅ Connected to:', targetId);
      setConnectedPeers(prev => {
        if (!prev.includes(targetId)) {
          return [...prev, targetId];
        }
        return prev;
      });
    });

    peer.on('data', (data) => {
      handleFileData(targetId, data);
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error with', targetId, ':', err);
      peersRef.current.delete(targetId);
      setConnectedPeers(prev => prev.filter(id => id !== targetId));
    });

    peer.on('close', () => {
      console.log('🔌 Connection closed with:', targetId);
      peersRef.current.delete(targetId);
      setConnectedPeers(prev => prev.filter(id => id !== targetId));
    });

    peersRef.current.set(targetId, peer);
    return peer;
  }, [socket, roomId, socketId, handleFileData]);

  // Initialize socket - FIXED: No dependencies to prevent loop
  useEffect(() => {
    console.log('🔌 Initializing socket connection...');
    const newSocket = io(SOCKET_URL, {
      forceNew: true,
      transports: ['websocket', 'polling']
    });
    
    newSocket.on('connect', () => {
      console.log('🔌 Socket connected:', newSocket.id);
      setSocketId(newSocket.id);
    });

    newSocket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
      setSocketId(null);
    });

    newSocket.on('users-updated', ({ users }) => {
      console.log('👥 Users updated:', users);
      setRoomUsers(users);
      
      // Try to connect to new users - only initiate if we have lower socket ID to prevent conflicts
      users.forEach(user => {
        if (user.id !== newSocket.id && !peersRef.current.has(user.id)) {
          // Only initiate connection if our socket ID is "smaller" to prevent both sides initiating
          const shouldInitiate = newSocket.id < user.id;
          console.log(`🤝 Connection decision: ${newSocket.id} vs ${user.id} - ${shouldInitiate ? 'INITIATE' : 'WAIT'}`);
          
          if (shouldInitiate) {
            setTimeout(() => {
              // Create peer inline to avoid dependency issues
              const peer = new SimplePeer({
                initiator: true,
                trickle: false,
              config: {
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' }
                ]
              }
            });

            peer.on('signal', (data) => {
              newSocket.emit('signal', {
                roomId: roomIdRef.current,
                targetId: user.id,
                signal: data
              });
            });

            peer.on('connect', () => {
              console.log('✅ Connected to:', user.id);
              setConnectedPeers(prev => {
                if (!prev.includes(user.id)) {
                  return [...prev, user.id];
                }
                return prev;
              });
            });

            peer.on('data', (data) => {
              handleFileData(user.id, data);
            });

            peer.on('error', (err) => {
              console.error('❌ Peer error with', user.id, ':', err);
              peersRef.current.delete(user.id);
              setConnectedPeers(prev => prev.filter(id => id !== user.id));
            });

            peersRef.current.set(user.id, peer);
            }, 500);
          }
        }
      });
    });

    newSocket.on('peer-joined', ({ peerId }) => {
      console.log('👋 Peer joined:', peerId);
      if (peerId !== newSocket.id && !peersRef.current.has(peerId)) {
        // Only initiate connection if our socket ID is "smaller" to prevent both sides initiating
        const shouldInitiate = newSocket.id < peerId;
        console.log(`🤝 Peer-joined decision: ${newSocket.id} vs ${peerId} - ${shouldInitiate ? 'INITIATE' : 'WAIT'}`);
        
        if (shouldInitiate) {
          // Create peer inline
          const peer = new SimplePeer({
            initiator: true,
            trickle: false,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        });

        peer.on('signal', (data) => {
          newSocket.emit('signal', {
            roomId: roomIdRef.current,
            targetId: peerId,
            signal: data
          });
        });

        peer.on('connect', () => {
          console.log('✅ Connected to:', peerId);
          setConnectedPeers(prev => {
            if (!prev.includes(peerId)) {
              return [...prev, peerId];
            }
            return prev;
          });
        });

        peer.on('data', (data) => {
          handleFileData(peerId, data);
        });

        peer.on('error', (err) => {
          console.error('❌ Peer error with', peerId, ':', err);
          peersRef.current.delete(peerId);
          setConnectedPeers(prev => prev.filter(id => id !== peerId));
        });

          peersRef.current.set(peerId, peer);
        }
      }
    });

    newSocket.on('signal', ({ senderId, signal }) => {
      console.log('📡 Received signal from:', senderId, 'type:', signal.type);
      
      let peer = peersRef.current.get(senderId);
      if (!peer) {
        console.log('🆕 Creating new peer for incoming signal from:', senderId);
        peer = new SimplePeer({
          initiator: false,
          trickle: false,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        });

        peer.on('signal', (data) => {
          console.log('📡 Sending response signal to:', senderId, 'type:', data.type);
          newSocket.emit('signal', {
            roomId: roomIdRef.current,
            targetId: senderId,
            signal: data
          });
        });

        peer.on('connect', () => {
          console.log('✅ Connected to:', senderId);
          setConnectedPeers(prev => {
            if (!prev.includes(senderId)) {
              return [...prev, senderId];
            }
            return prev;
          });
        });

        peer.on('data', (data) => {
          handleFileData(senderId, data);
        });

        peer.on('error', (err) => {
          console.error('❌ Peer error with', senderId, ':', err);
          peersRef.current.delete(senderId);
          setConnectedPeers(prev => prev.filter(id => id !== senderId));
        });

        peersRef.current.set(senderId, peer);
      }
      
      // Only process signal if peer is not destroyed and in appropriate state
      if (!peer.destroyed) {
        try {
          console.log('🔧 Processing signal for peer:', senderId);
          peer.signal(signal);
        } catch (err) {
          console.error('❌ Signal processing error:', err);
          // Clean up and recreate peer if signal fails
          peer.destroy();
          peersRef.current.delete(senderId);
          setConnectedPeers(prev => prev.filter(id => id !== senderId));
        }
      } else {
        console.log('⚠️ Ignoring signal for destroyed peer:', senderId);
      }
    });

    newSocket.on('peer-disconnected', ({ peerId }) => {
      console.log('👋 Peer disconnected:', peerId);
      const peer = peersRef.current.get(peerId);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(peerId);
        setConnectedPeers(prev => prev.filter(id => id !== peerId));
      }
    });

    setSocket(newSocket);

    return () => {
      console.log('🔌 Cleaning up socket connection...');
      newSocket.close();
      peersRef.current.forEach(peer => peer.destroy());
      peersRef.current.clear();
    };
  }, []); // EMPTY DEPENDENCIES to prevent recreation loop

  const createRoom = useCallback(() => {
    console.log('🏠 Attempting to create room...', { socket: !!socket, socketId });
    
    if (!socket) {
      console.error('❌ No socket connection!');
      alert('Not connected to server. Please refresh the page.');
      return;
    }
    
    if (!socket.connected) {
      console.error('❌ Socket not connected!');
      alert('Connection lost. Please refresh the page.');
      return;
    }
    
    console.log('📡 Emitting create-room event...');
    socket.emit('create-room', (response) => {
      console.log('📨 Create room response:', response);
      if (response && response.roomId) {
        setRoomId(response.roomId);
        roomIdRef.current = response.roomId;
        setIsHost(true);
        console.log('✅ Room created successfully:', response.roomId);
        
        // Send user name after creating room
        setTimeout(() => {
          console.log('📝 Updating user name...');
          socket.emit('update-user-name', { roomId: response.roomId, userName });
        }, 500);
      } else {
        console.error('❌ Failed to create room:', response);
        alert('Failed to create room. Please try again.');
      }
    });
  }, [socket, socketId, userName]);

  const joinRoom = useCallback((roomCode) => {
    console.log('🚪 Attempting to join room:', roomCode, { socket: !!socket, socketId });
    
    if (!socket) {
      console.error('❌ No socket connection for joining room!');
      alert('Not connected to server. Please refresh the page.');
      return;
    }
    
    if (!socket.connected) {
      console.error('❌ Socket not connected for joining room!');
      alert('Connection lost. Please refresh the page.');
      return;
    }
    
    if (!roomCode || !roomCode.trim()) {
      alert('Please enter a valid room code.');
      return;
    }
    
    console.log('📡 Emitting join-room event for:', roomCode);
    socket.emit('join-room', roomCode.trim(), (response) => {
      console.log('📨 Join room response:', response);
      
      if (response && response.error) {
        console.error('❌ Join room error:', response.error);
        alert(`Failed to join room: ${response.error}`);
      } else if (response && response.success) {
        setRoomId(roomCode.trim());
        roomIdRef.current = roomCode.trim();
        setIsHost(response.isHost || false);
        console.log('✅ Successfully joined room:', roomCode);
        
        // Send name update
        setTimeout(() => {
          console.log('📝 Updating user name in room...');
          socket.emit('update-user-name', { roomId: roomCode.trim(), userName });
        }, 500);
      } else {
        console.error('❌ Unexpected join room response:', response);
        alert('Unexpected response when joining room. Please try again.');
      }
    });
  }, [socket, socketId, userName]);

  const updateUserName = useCallback((newName) => {
    setUserName(newName);
    if (socket && roomId) {
      socket.emit('update-user-name', { roomId, userName: newName });
    }
  }, [socket, roomId]);

  const sendFileInChunks = useCallback(async (file) => {
    if (!file || connectedPeers.length === 0) {
      console.log('❌ No peers connected or no file selected');
      return;
    }

    // Check file size limit
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large! Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      return;
    }

    console.log('📤 Sending file to', connectedPeers.length, 'peers');
    setTransferStatus('sending');

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        // Remove data URL prefix to get just base64
        const base64Data = e.target.result.split(',')[1];
        const timestamp = Date.now();
        
        // Calculate chunks
        const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
        console.log(`📦 File will be sent in ${totalChunks} chunks of max ${CHUNK_SIZE} bytes`);

        // Add to own shared files first
        const fileInfo = {
          id: `self-${timestamp}`,
          url: e.target.result,
          name: file.name,
          size: file.size,
          type: file.type,
          sender: userName + ' (You)',
          senderId: socketId,
          timestamp: new Date().toISOString(),
          isImage: file.type.startsWith('image/'),
          isVideo: file.type.startsWith('video/')
        };
        setSharedFiles(prev => [...prev, fileInfo]);

        // Send to all connected peers
        for (const [peerId, peer] of peersRef.current) {
          if (!peer.connected) continue;

          try {
            // Send metadata first
            const metadata = {
              type: 'file-metadata',
              name: file.name,
              size: file.size,
              fileType: file.type,
              senderName: userName,
              totalChunks,
              timestamp
            };
            
            peer.send(JSON.stringify(metadata));
            console.log(`📋 Metadata sent to ${peerId} for ${file.name}`);

            // Send chunks with delay to prevent overwhelming
            for (let i = 0; i < totalChunks; i++) {
              const start = i * CHUNK_SIZE;
              const end = Math.min(start + CHUNK_SIZE, base64Data.length);
              const chunkData = base64Data.slice(start, end);

              const chunk = {
                type: 'file-chunk',
                fileName: file.name,
                chunkIndex: i,
                data: chunkData,
                timestamp
              };

              peer.send(JSON.stringify(chunk));
              console.log(`📦 Chunk ${i + 1}/${totalChunks} sent to ${peerId}`);

              // Small delay between chunks to prevent data channel overflow
              if (i < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }

            console.log(`✅ All chunks sent to: ${peerId}`);
          } catch (err) {
            console.error(`❌ Failed to send to ${peerId}:`, err);
          }
        }

        setTransferStatus('idle');
        console.log('✅ File transfer completed');
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('❌ File transfer error:', error);
      setTransferStatus('idle');
    }
  }, [connectedPeers, userName, socketId]);

  // Legacy single-send for small files (under 1MB)
  const sendFile = useCallback((file) => {
    if (!file || connectedPeers.length === 0) {
      console.log('❌ No peers connected or no file selected');
      return;
    }

    // Use chunked sending for all files now
    sendFileInChunks(file);
  }, [sendFileInChunks]);

  const testConnections = useCallback(() => {
    console.log('🧪 Testing connections...');
    peersRef.current.forEach((peer, peerId) => {
      if (peer.connected) {
        peer.send(JSON.stringify({ 
          type: 'test', 
          message: `Test from ${userName}`,
          from: socketId 
        }));
        console.log('✅ Test sent to:', peerId);
      } else {
        console.log('❌ Peer not connected:', peerId);
      }
    });
  }, [userName, socketId]);

  const diagnose = useCallback(() => {
    console.log('🔍 === SIMPLE DIAGNOSTICS ===');
    console.log('Socket Object:', socket);
    console.log('Socket ID:', socketId);
    console.log('Socket Connected:', socket?.connected);
    console.log('Room ID:', roomId);
    console.log('Is Host:', isHost);
    console.log('Room Users:', roomUsers.length, roomUsers);
    console.log('Connected Peers:', connectedPeers.length, connectedPeers);
    console.log('Peers Map Size:', peersRef.current.size);
    console.log('Shared Files:', sharedFiles.length);
    console.log('User Name:', userName);
    
    peersRef.current.forEach((peer, peerId) => {
      console.log(`Peer ${peerId}: connected=${peer.connected}, destroyed=${peer.destroyed}`);
    });
    console.log('🔍 === END DIAGNOSTICS ===');
  }, [socket, socketId, roomId, isHost, roomUsers, connectedPeers, sharedFiles, userName]);

  return {
    roomId,
    isHost,
    socketId,
    roomUsers,
    connectedPeers,
    userName,
    sharedFiles,
    transferStatus,
    transferProgress,
    createRoom,
    joinRoom,
    updateUserName,
    sendFile,
    testConnections,
    diagnose,
    peers: connectedPeers // For compatibility
  };
};