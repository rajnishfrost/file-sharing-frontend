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

export const useWebRTC = () => {
  const [socket, setSocket] = useState(null);
  const [peer, setPeer] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState('idle');
  const [fileToSend, setFileToSend] = useState(null);
  const [receivedFile, setReceivedFile] = useState(null);
  const [userName, setUserName] = useState(() => generateRandomName());
  const [connectedUser, setConnectedUser] = useState(null);
  const [sharedFiles, setSharedFiles] = useState([]);
  
  const chunksRef = useRef([]);
  const fileMetadataRef = useRef(null);
  const totalChunksRef = useRef(0);
  const receivedChunksRef = useRef(0);
  const peerRef = useRef(null);

  const handleIncomingData = (data) => {
    console.log('📨 Incoming data type:', typeof data, 'Length:', data.length || data.byteLength || 'N/A');
    
    // Try to detect if binary data is actually a string message
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      try {
        const text = new TextDecoder().decode(data);
        console.log('🔍 Trying to decode binary as text:', text);
        if (text.startsWith('{') && text.endsWith('}')) {
          console.log('✅ Binary data is actually JSON string!');
          const message = JSON.parse(text);
          console.log('📋 Parsed message from binary:', message);
          
          if (message.type === 'userInfo') {
            setConnectedUser({
              name: message.userName,
              id: message.userId
            });
            console.log('👤 Connected user:', message.userName);
            return;
          } else if (message.type === 'metadata') {
            fileMetadataRef.current = {
              name: message.name,
              size: message.size,
              type: message.mimeType,
              sender: connectedUser?.name || 'Unknown',
              timestamp: new Date().toISOString()
            };
            totalChunksRef.current = Math.ceil(message.size / CHUNK_SIZE);
            chunksRef.current = [];
            receivedChunksRef.current = 0;
            setTransferStatus('receiving');
            console.log('📂 Receiving file:', message.name, 'Size:', message.size, 'Total chunks expected:', totalChunksRef.current);
            return;
          } else if (message.type === 'complete') {
            console.log('✅ File transfer complete, creating blob...', chunksRef.current.length, 'chunks received');
            
            if (!fileMetadataRef.current) {
              console.error('No file metadata found!');
              return;
            }
            
            if (chunksRef.current.length === 0) {
              console.error('No file chunks received!');
              return;
            }
            
            const blob = new Blob(chunksRef.current, { 
              type: fileMetadataRef.current.type 
            });
            const url = URL.createObjectURL(blob);
            const fileInfo = {
              id: Date.now().toString(),
              url,
              name: fileMetadataRef.current.name,
              size: fileMetadataRef.current.size,
              type: fileMetadataRef.current.type,
              sender: fileMetadataRef.current.sender || 'Unknown',
              timestamp: fileMetadataRef.current.timestamp || new Date().toISOString(),
              isImage: fileMetadataRef.current.type.startsWith('image/'),
              isVideo: fileMetadataRef.current.type.startsWith('video/')
            };
            
            console.log('💾 Adding file to shared files:', fileInfo);
            setSharedFiles(prev => {
              const newFiles = [...prev, fileInfo];
              console.log('📁 Updated shared files array:', newFiles.length, 'files');
              return newFiles;
            });
            setReceivedFile(fileInfo);
            setTransferStatus('complete');
            setTransferProgress(100);
            console.log('🎉 File ready for download:', fileMetadataRef.current.name);
            return;
          }
        }
      } catch (e) {
        console.log('🔗 Not a text message, treating as binary chunk');
      }
    }
    
    if (typeof data === 'string') {
      console.log('📝 String message received:', data);
      const message = JSON.parse(data);
      console.log('📋 Parsed message:', message);
      
      if (message.type === 'userInfo') {
        setConnectedUser({
          name: message.userName,
          id: message.userId
        });
        console.log('👤 Connected user:', message.userName);
      } else if (message.type === 'metadata') {
        fileMetadataRef.current = {
          name: message.name,
          size: message.size,
          type: message.mimeType,
          sender: connectedUser?.name || 'Unknown',
          timestamp: new Date().toISOString()
        };
        totalChunksRef.current = Math.ceil(message.size / CHUNK_SIZE);
        chunksRef.current = [];
        receivedChunksRef.current = 0;
        setTransferStatus('receiving');
        console.log('📂 Receiving file:', message.name, 'Size:', message.size, 'Total chunks expected:', totalChunksRef.current);
      } else if (message.type === 'complete') {
        console.log('✅ File transfer complete, creating blob...', chunksRef.current.length, 'chunks received');
        
        if (!fileMetadataRef.current) {
          console.error('No file metadata found!');
          return;
        }
        
        if (chunksRef.current.length === 0) {
          console.error('No file chunks received!');
          return;
        }
        
        const blob = new Blob(chunksRef.current, { 
          type: fileMetadataRef.current.type 
        });
        const url = URL.createObjectURL(blob);
        const fileInfo = {
          id: Date.now().toString(),
          url,
          name: fileMetadataRef.current.name,
          size: fileMetadataRef.current.size,
          type: fileMetadataRef.current.type,
          sender: fileMetadataRef.current.sender || 'Unknown',
          timestamp: fileMetadataRef.current.timestamp || new Date().toISOString(),
          isImage: fileMetadataRef.current.type.startsWith('image/'),
          isVideo: fileMetadataRef.current.type.startsWith('video/')
        };
        
        console.log('💾 Adding file to shared files:', fileInfo);
        setSharedFiles(prev => {
          const newFiles = [...prev, fileInfo];
          console.log('📁 Updated shared files array:', newFiles.length, 'files');
          return newFiles;
        });
        setReceivedFile(fileInfo);
        setTransferStatus('complete');
        setTransferProgress(100);
        console.log('🎉 File ready for download:', fileMetadataRef.current.name);
      }
    } else {
      console.log('🔗 Received binary chunk:', data.byteLength || data.length, 'bytes');
      chunksRef.current.push(data);
      receivedChunksRef.current++;
      if (totalChunksRef.current > 0) {
        const progress = (receivedChunksRef.current / totalChunksRef.current) * 100;
        setTransferProgress(progress);
        if (receivedChunksRef.current % 10 === 0) {
          console.log('📊 Progress:', progress.toFixed(2) + '%', `(${receivedChunksRef.current}/${totalChunksRef.current})`);
        }
      } else {
        console.warn('⚠️ Received chunk but no metadata yet!');
      }
    }
  };

  const sendFile = async (peerConnection, file) => {
    if (!file) return;
    console.log('📤 Starting file send:', file.name, 'Size:', file.size, 'Type:', file.type);
    
    const metadata = {
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type
    };
    
    console.log('📤 Sending metadata:', metadata);
    peerConnection.send(JSON.stringify(metadata));
    setTransferStatus('sending');
    console.log('✅ Metadata sent');
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target.result;
      const chunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);
        
        peerConnection.send(chunk);
        setTransferProgress(((i + 1) / chunks) * 100);
        
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
      const completeMessage = { type: 'complete' };
      console.log('📤 Sending completion signal:', completeMessage);
      peerConnection.send(JSON.stringify(completeMessage));
      setTransferStatus('complete');
      console.log('✅ File send complete, sent completion signal');
    };
    
    reader.readAsArrayBuffer(file);
  };

  const initiatePeerConnection = useCallback((initiator, socketInstance, incomingSignal = null) => {
    try {
      const newPeer = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: {
          iceServers: [
            {
              urls: 'stun:stun.l.google.com:19302'
            },
            {
              urls: 'stun:global.stun.twilio.com:3478'
            }
          ]
        }
      });

    newPeer.on('signal', (signal) => {
      if (roomId) {
        socketInstance.emit('signal', {
          roomId: roomId,
          signal
        });
        console.log('Sending signal for room:', roomId);
      }
    });

    if (incomingSignal) {
      newPeer.signal(incomingSignal);
    }

    newPeer.on('connect', () => {
      console.log('Peer connected');
      setIsConnected(true);
      setTransferStatus('connected');
      
      // Send user info when connected
      newPeer.send(JSON.stringify({
        type: 'userInfo',
        userName: userName,
        userId: socket?.id || 'unknown'
      }));
      
      // Only send file if host has selected one
      if (initiator && fileToSend) {
        setTimeout(() => {
          sendFile(newPeer, fileToSend);
        }, 500);
      }
    });

    newPeer.on('data', (data) => {
      handleIncomingData(data);
    });

    newPeer.on('error', (err) => {
      console.error('Peer error:', err);
      setTransferStatus('error');
    });

    setPeer(newPeer);
    peerRef.current = newPeer;
    } catch (error) {
      console.error('Error creating peer connection:', error);
      setTransferStatus('error');
    }
  }, [roomId, fileToSend, isHost]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handlePeerJoined = ({ peerId }) => {
      console.log('Peer joined:', peerId);
      if (isHost) {
        // Host initiates connection when guest joins
        initiatePeerConnection(true, socket);
      }
    };

    const handleSignal = ({ senderId, signal }) => {
      if (peerRef.current) {
        peerRef.current.signal(signal);
      } else {
        initiatePeerConnection(false, socket, signal);
      }
    };

    const handlePeerDisconnected = () => {
      setIsConnected(false);
      setTransferStatus('disconnected');
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
        setPeer(null);
      }
    };

    socket.on('peer-joined', handlePeerJoined);
    socket.on('signal', handleSignal);
    socket.on('peer-disconnected', handlePeerDisconnected);

    return () => {
      socket.off('peer-joined', handlePeerJoined);
      socket.off('signal', handleSignal);
      socket.off('peer-disconnected', handlePeerDisconnected);
    };
  }, [socket, isHost, fileToSend, initiatePeerConnection]);

  const createRoom = useCallback(() => {
    if (!socket) return;
    
    socket.emit('create-room', ({ roomId }) => {
      setRoomId(roomId);
      setIsHost(true);
      setTransferStatus('waiting');
    });
  }, [socket]);

  const joinRoom = useCallback((roomCode) => {
    if (!socket) return;
    
    socket.emit('join-room', roomCode, (response) => {
      if (response.error) {
        setTransferStatus('error');
        alert(response.error);
      } else {
        setRoomId(roomCode);
        setIsHost(false);
        setTransferStatus('waiting');
      }
    });
  }, [socket]);

  const selectFile = useCallback((file) => {
    setFileToSend(file);
    fileMetadataRef.current = {
      name: file.name,
      size: file.size,
      type: file.type
    };
    
    // If already connected and we're the host, send the file
    if (isConnected && isHost && peerRef.current && file) {
      sendFile(peerRef.current, file);
    }
  }, [isConnected, isHost]);

  const updateUserName = useCallback((newName) => {
    setUserName(newName);
    if (peerRef.current && isConnected) {
      peerRef.current.send(JSON.stringify({
        type: 'userInfo',
        userName: newName,
        userId: socket?.id || 'unknown'
      }));
    }
  }, [isConnected, socket]);

  const addTestFile = useCallback(() => {
    const testFile = {
      id: Date.now().toString(),
      url: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
      name: 'test-file.txt',
      size: 1024,
      type: 'text/plain',
      sender: 'Test User',
      timestamp: new Date().toISOString(),
      isImage: false,
      isVideo: false
    };
    console.log('Adding test file manually');
    setSharedFiles(prev => [...prev, testFile]);
  }, []);

  return {
    roomId,
    isHost,
    isConnected,
    transferProgress,
    transferStatus,
    fileToSend,
    receivedFile,
    userName,
    connectedUser,
    sharedFiles,
    createRoom,
    joinRoom,
    selectFile,
    updateUserName,
    addTestFile,
  };
};