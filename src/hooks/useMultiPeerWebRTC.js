import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const CHUNK_SIZE = 16384;

const generateRandomName = () => {
  const adjectives = ['Cool', 'Smart', 'Quick', 'Bright', 'Swift', 'Bold', 'Clever', 'Happy'];
  const animals = ['Tiger', 'Eagle', 'Dolphin', 'Lion', 'Fox', 'Wolf', 'Bear', 'Hawk'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}${Math.floor(Math.random() * 99)}`;
};

export const useMultiPeerWebRTC = () => {
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);
  const [peers, setPeers] = useState(new Map()); // Map of peerId -> peer connection
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomUsers, setRoomUsers] = useState([]);
  const [transferProgress, setTransferProgress] = useState({});
  const [transferStatus, setTransferStatus] = useState('idle');
  const [userName, setUserName] = useState(() => generateRandomName());
  const [sharedFiles, setSharedFiles] = useState([]);
  
  const peersRef = useRef(new Map());
  const chunksRef = useRef(new Map()); // Map of peerId -> chunks array
  const fileMetadataRef = useRef(new Map()); // Map of peerId -> file metadata

  const handleIncomingData = useCallback((peerId, data) => {
    console.log(`📨 Data from ${peerId}:`, typeof data, 'size:', data.length || data.byteLength || 'unknown');
    
    // Try to parse as JSON first
    let isJson = false;
    let message = null;
    
    if (typeof data === 'string') {
      try {
        message = JSON.parse(data);
        isJson = true;
      } catch (e) {
        console.log('Not JSON string data');
      }
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      try {
        const text = new TextDecoder().decode(data);
        if (text.startsWith('{') && text.endsWith('}')) {
          message = JSON.parse(text);
          isJson = true;
        }
      } catch (e) {
        console.log('Binary data received, chunk size:', data.byteLength || data.length);
      }
    }
    
    if (isJson && message) {
      if (message.type === 'ping') {
        console.log(`Ping received from ${peerId}`);
        return;
      } else if (message.type === 'test') {
        console.log(`🧪 Test message received from ${peerId}:`, message.message);
        return;
      } else if (message.type === 'metadata') {
        fileMetadataRef.current.set(peerId, {
          name: message.name,
          size: message.size,
          type: message.mimeType,
          sender: message.sender || peerId,
          senderName: message.senderName,
          timestamp: new Date().toISOString(),
          totalChunks: Math.ceil(message.size / CHUNK_SIZE)
        });
        
        chunksRef.current.set(peerId, []);
        setTransferStatus('receiving');
        setTransferProgress(prev => ({ ...prev, [peerId]: 0 }));
        console.log(`📂 Receiving file from ${peerId}:`, message.name);
        
      } else if (message.type === 'complete') {
        const chunks = chunksRef.current.get(peerId);
        const metadata = fileMetadataRef.current.get(peerId);
        
        if (chunks && metadata) {
          const blob = new Blob(chunks, { type: metadata.type });
          const url = URL.createObjectURL(blob);
          
          const fileInfo = {
            id: `${peerId}-${Date.now()}`,
            url,
            name: metadata.name,
            size: metadata.size,
            type: metadata.type,
            sender: metadata.senderName || 'Unknown',
            senderId: peerId,
            timestamp: metadata.timestamp,
            isImage: metadata.type.startsWith('image/'),
            isVideo: metadata.type.startsWith('video/')
          };
          
          console.log('💾 Adding received file to shared files:', fileInfo);
          setSharedFiles(prev => {
            // Check if file already exists (avoid duplicates)
            const exists = prev.find(f => f.name === fileInfo.name && f.senderId === fileInfo.senderId);
            if (!exists) {
              const newFiles = [...prev, fileInfo];
              console.log('📁 Updated shared files array:', newFiles.length, 'files');
              return newFiles;
            } else {
              console.log('📁 File already exists, skipping duplicate');
              return prev;
            }
          });
          setTransferProgress(prev => ({ ...prev, [peerId]: 100 }));
          console.log(`🎉 File ready for download from ${peerId}:`, metadata.name);
          
          // Cleanup
          chunksRef.current.delete(peerId);
          fileMetadataRef.current.delete(peerId);
        }
      }
    } else {
      // Binary chunk
      const chunks = chunksRef.current.get(peerId);
      if (chunks) {
        chunks.push(data);
        const metadata = fileMetadataRef.current.get(peerId);
        if (metadata && metadata.totalChunks > 0) {
          const progress = (chunks.length / metadata.totalChunks) * 100;
          setTransferProgress(prev => ({ ...prev, [peerId]: progress }));
        }
      }
    }
  }, []);

  const createPeerConnection = useCallback((targetId, initiator = false, signal = null) => {
    console.log(`Creating peer connection to ${targetId}, initiator: ${initiator}`);
    
    // Check if peer already exists
    if (peersRef.current.has(targetId)) {
      console.log(`⚠️ Peer connection already exists for ${targetId}, skipping creation`);
      return peersRef.current.get(targetId);
    }
    
    const peer = new SimplePeer({
      initiator,
      trickle: true, // Enable trickle for Chrome (better performance)
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'stun:stun.services.mozilla.com' }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 10
      },
      allowHalfTrickle: true,
      channelConfig: {
        ordered: true,
        maxRetransmits: 30
      }
    });
    
    peer.on('signal', (signalData) => {
      if (socket && roomId) {
        socket.emit('signal', {
          roomId,
          targetId,
          signal: signalData
        });
      }
    });
    
    peer.on('connect', () => {
      console.log(`✅ Connected to peer: ${targetId}`);
      // Send a test message to verify connection
      setTimeout(() => {
        if (peer.connected) {
          peer.send(JSON.stringify({ type: 'ping', from: socketId }));
        }
      }, 500);
    });
    
    peer.on('data', (data) => {
      console.log(`Data received from ${targetId}, size:`, data.length || data.byteLength || 'unknown');
      handleIncomingData(targetId, data);
    });
    
    peer.on('error', (err) => {
      console.error(`❌ Peer error with ${targetId}:`, err.message || err);
      // Clean up failed connection
      peersRef.current.delete(targetId);
      setPeers(new Map(peersRef.current));
      
      // Retry connection after delay
      console.log(`🔄 Retrying connection to ${targetId} in 3 seconds...`);
      setTimeout(() => {
        if (!peersRef.current.has(targetId)) {
          createPeerConnection(targetId, true);
        }
      }, 3000);
    });
    
    peer.on('close', () => {
      console.log(`Connection closed with ${targetId}`);
      peersRef.current.delete(targetId);
      setPeers(new Map(peersRef.current));
    });
    
    if (signal) {
      peer.signal(signal);
    }
    
    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      if (!peer.connected) {
        console.log(`⏰ Connection to ${targetId} timed out, destroying and retrying...`);
        peer.destroy();
        peersRef.current.delete(targetId);
        setPeers(new Map(peersRef.current));
        
        // Retry once
        setTimeout(() => {
          if (!peersRef.current.has(targetId)) {
            createPeerConnection(targetId, true);
          }
        }, 1000);
      }
    }, 15000); // 15 second timeout
    
    // Clear timeout when connected
    peer.once('connect', () => {
      clearTimeout(connectionTimeout);
    });
    
    peersRef.current.set(targetId, peer);
    setPeers(new Map(peersRef.current));
    
    return peer;
  }, [socket, roomId, socketId, handleIncomingData]);

  const sendFileToAll = useCallback(async (file) => {
    if (!file) return;
    
    const connectedPeers = Array.from(peersRef.current.entries()).filter(([_, peer]) => peer.connected);
    
    if (connectedPeers.length === 0) {
      console.log('⚠️ No connected peers to send file to');
      setTransferStatus('idle');
      return;
    }
    
    console.log(`📤 Sending file to ${connectedPeers.length} connected peers:`, file.name);
    setTransferStatus('sending');
    
    const metadata = {
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      sender: socket?.id,
      senderName: userName
    };
    
    // Send metadata to all connected peers
    connectedPeers.forEach(([peerId, peer]) => {
      console.log(`📋 Sending metadata to ${peerId}`);
      try {
        peer.send(JSON.stringify(metadata));
      } catch (err) {
        console.error(`Failed to send metadata to ${peerId}:`, err);
      }
    });
    
    // Read and send file chunks
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target.result;
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
      
      console.log(`📦 Sending ${totalChunks} chunks of size ${CHUNK_SIZE}`);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);
        
        // Send chunk to all connected peers
        connectedPeers.forEach(([peerId, peer]) => {
          if (peer.connected) {
            try {
              peer.send(chunk);
            } catch (err) {
              console.error(`Failed to send chunk ${i} to ${peerId}:`, err);
            }
          }
        });
        
        const progress = ((i + 1) / totalChunks) * 100;
        setTransferProgress({ sending: progress });
        
        // Small delay to prevent overwhelming the channel
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      
      // Send completion signal to all peers
      connectedPeers.forEach(([peerId, peer]) => {
        if (peer.connected) {
          console.log(`✅ Sending complete signal to ${peerId}`);
          try {
            peer.send(JSON.stringify({ type: 'complete' }));
          } catch (err) {
            console.error(`Failed to send complete to ${peerId}:`, err);
          }
        }
      });
      
      setTransferStatus('complete');
      console.log('✅ File sent to all peers');
      
      // Clear progress after a delay
      setTimeout(() => {
        setTransferProgress({});
        setTransferStatus('idle');
      }, 2000);
    };
    
    reader.onerror = (err) => {
      console.error('Failed to read file:', err);
      setTransferStatus('error');
    };
    
    reader.readAsArrayBuffer(file);
  }, [socket, userName]);

  const sendFileToPeer = useCallback(async (peerId, file) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || !peer.connected || !file) return;
    
    console.log(`📤 Sending file to peer ${peerId}:`, file.name);
    
    const metadata = {
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      sender: socket?.id,
      senderName: userName
    };
    
    peer.send(JSON.stringify(metadata));
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target.result;
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);
        
        peer.send(chunk);
        
        const progress = ((i + 1) / totalChunks) * 100;
        setTransferProgress(prev => ({ ...prev, [peerId]: progress }));
        
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
      peer.send(JSON.stringify({ type: 'complete' }));
      console.log(`✅ File sent to peer ${peerId}`);
    };
    
    reader.readAsArrayBuffer(file);
  }, [socket, userName]);

  const testConnections = useCallback(() => {
    console.log('🧪 Testing connections...');
    console.log(`Connected peers: ${peersRef.current.size}`);
    peersRef.current.forEach((peer, peerId) => {
      if (peer.connected) {
        peer.send(JSON.stringify({ type: 'test', message: 'Connection test', from: socketId }));
        console.log(`✅ Test message sent to ${peerId}`);
      } else {
        console.log(`❌ Peer ${peerId} not connected`);
      }
    });
  }, [socketId]);

  const forceReconnect = useCallback(() => {
    console.log('🔄 Forcing reconnection to all users...');
    console.log('Current state:', {
      socketId,
      roomUsers: roomUsers.map(u => ({ id: u.id, name: u.name })),
      currentPeers: Array.from(peersRef.current.keys()),
      roomId
    });
    
    // Clear all existing connections
    peersRef.current.forEach(peer => peer.destroy());
    peersRef.current.clear();
    setPeers(new Map());
    
    // Reconnect to all room users after a delay
    setTimeout(() => {
      console.log('🔗 Starting reconnection process...');
      roomUsers.forEach(user => {
        if (user.id !== socketId) {
          console.log(`🔗 Reconnecting to ${user.id} (${user.name || 'Unknown'})`);
          createPeerConnection(user.id, true);
        }
      });
    }, 1000);
  }, [socketId, roomUsers, createPeerConnection, roomId]);

  const runDiagnostics = useCallback(() => {
    console.log('🔍 === CONNECTION DIAGNOSTICS ===');
    console.log('Socket ID:', socketId);
    console.log('Room ID:', roomId);
    console.log('Room Users:', roomUsers);
    console.log('Current Peers:', Array.from(peersRef.current.keys()));
    console.log('Expected Connections:', roomUsers.length - 1);
    console.log('Actual Connections:', peersRef.current.size);
    console.log('Socket Connected:', socket?.connected);
    console.log('Browser:', navigator.userAgent);
    
    peersRef.current.forEach((peer, peerId) => {
      console.log(`Peer ${peerId}:`, {
        connected: peer.connected,
        connecting: peer.connecting,
        destroyed: peer.destroyed
      });
    });
    
    console.log('🔍 === END DIAGNOSTICS ===');
  }, [socketId, roomId, roomUsers, socket]);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setSocketId(newSocket.id);
    });
    
    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketId(null);
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.close();
      peersRef.current.forEach(peer => peer.destroy());
    };
  }, []);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    const handleUsersUpdated = ({ users }) => {
      console.log('📊 Users updated:', users.map(u => ({ id: u.id, name: u.name })));
      setRoomUsers(users);
      
      // Connect to any new users we haven't connected to yet
      if (socketId) {
        users.forEach(user => {
          if (user.id !== socketId && !peersRef.current.has(user.id)) {
            console.log(`🔗 Creating new connection: ${socketId} -> ${user.id}`);
            // Add small delay to prevent connection conflicts
            setTimeout(() => {
              createPeerConnection(user.id, true);
            }, 500);
          }
        });
        
        // Log current connection status
        console.log(`📡 Current connections: ${peersRef.current.size}/${users.length - 1}`);
        peersRef.current.forEach((peer, peerId) => {
          console.log(`- ${peerId}: ${peer.connected ? 'connected' : 'connecting'}`);
        });
      }
    };
    
    const handlePeerJoined = ({ peerId }) => {
      console.log('New peer joined:', peerId);
      if (!peersRef.current.has(peerId) && peerId !== socketId) {
        createPeerConnection(peerId, true);
      }
    };
    
    const handleSignal = ({ senderId, signal }) => {
      console.log('Received signal from:', senderId);
      const peer = peersRef.current.get(senderId);
      if (peer) {
        peer.signal(signal);
      } else {
        createPeerConnection(senderId, false, signal);
      }
    };
    
    const handlePeerDisconnected = ({ peerId }) => {
      console.log('Peer disconnected:', peerId);
      const peer = peersRef.current.get(peerId);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(peerId);
        setPeers(new Map(peersRef.current));
      }
    };
    
    const handleHostChanged = ({ newHost }) => {
      setIsHost(socket.id === newHost);
      console.log('Host changed to:', newHost);
    };
    
    socket.on('users-updated', handleUsersUpdated);
    socket.on('peer-joined', handlePeerJoined);
    socket.on('signal', handleSignal);
    socket.on('peer-disconnected', handlePeerDisconnected);
    socket.on('host-changed', handleHostChanged);
    
    return () => {
      socket.off('users-updated', handleUsersUpdated);
      socket.off('peer-joined', handlePeerJoined);
      socket.off('signal', handleSignal);
      socket.off('peer-disconnected', handlePeerDisconnected);
      socket.off('host-changed', handleHostChanged);
    };
  }, [socket, socketId, createPeerConnection]);

  const createRoom = useCallback(() => {
    if (!socket) return;
    
    socket.emit('create-room', ({ roomId }) => {
      setRoomId(roomId);
      setIsHost(true);
      setTransferStatus('waiting');
      console.log('Room created:', roomId);
      
      // Send user name after creating room
      setTimeout(() => {
        if (socket && roomId) {
          socket.emit('update-user-name', { roomId, userName });
        }
      }, 100);
    });
  }, [socket, userName]);

  const joinRoom = useCallback((roomCode) => {
    if (!socket) return;
    
    socket.emit('join-room', roomCode, (response) => {
      if (response.error) {
        alert(response.error);
        setTransferStatus('error');
      } else {
        setRoomId(roomCode);
        setIsHost(response.isHost);
        setRoomUsers(response.users || []);
        setTransferStatus('waiting');
        
        // Send user name immediately after joining
        setTimeout(() => {
          if (socket && roomCode) {
            socket.emit('update-user-name', { roomId: roomCode, userName });
          }
        }, 100);
        
        // Connect to existing peers
        if (response.existingPeers && response.existingPeers.length > 0) {
          response.existingPeers.forEach(peerId => {
            createPeerConnection(peerId, true);
          });
        }
        
        console.log('Joined room:', roomCode);
      }
    });
  }, [socket, createPeerConnection, userName]);

  const updateUserName = useCallback((newName) => {
    setUserName(newName);
    if (socket && roomId) {
      socket.emit('update-user-name', { roomId, userName: newName });
    }
  }, [socket, roomId]);

  const selectAndSendFile = useCallback((file) => {
    if (!file) return;
    
    console.log(`📤 Preparing to send file: ${file.name} to ${peersRef.current.size} peers`);
    
    // Add to own shared files immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileInfo = {
        id: `self-${Date.now()}`,
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
      
      console.log('📁 Adding file to own list:', fileInfo);
      setSharedFiles(prev => {
        // Avoid duplicates
        const exists = prev.find(f => f.name === fileInfo.name && f.senderId === socketId);
        if (!exists) {
          return [...prev, fileInfo];
        }
        return prev;
      });
    };
    reader.readAsDataURL(file);
    
    // Send to all connected peers
    if (peersRef.current.size > 0) {
      console.log(`📤 Sending to ${peersRef.current.size} connected peers`);
      sendFileToAll(file);
    } else {
      console.log('⚠️ No peer connections available, waiting for connections...');
      // Retry sending when peers connect
      setTimeout(() => {
        if (peersRef.current.size > 0) {
          console.log('🔄 Retrying file send after connection');
          sendFileToAll(file);
        }
      }, 2000);
    }
  }, [sendFileToAll, userName, socketId]);

  return {
    roomId,
    isHost,
    socketId,
    roomUsers,
    peers: Array.from(peers.keys()),
    transferProgress,
    transferStatus,
    userName,
    sharedFiles,
    createRoom,
    joinRoom,
    selectAndSendFile,
    updateUserName,
    sendFileToPeer,
    testConnections,
    forceReconnect,
    runDiagnostics,
  };
};