import React, { useState } from 'react';

const RoomManager = ({ roomId, onCreateRoom, onJoinRoom, isHost }) => {
  const [inputRoomId, setInputRoomId] = useState('');

  const handleJoin = () => {
    if (inputRoomId.trim()) {
      onJoinRoom(inputRoomId.trim());
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied to clipboard!');
  };

  const shareLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    alert('Share link copied to clipboard!');
  };

  if (roomId && isHost) {
    return (
      <div className="room-manager">
        <h3>Share this Room ID with your recipient:</h3>
        <div className="room-display">
          <code className="room-code">{roomId}</code>
          <div className="room-actions">
            <button onClick={copyToClipboard} className="btn-secondary">
              Copy ID
            </button>
            <button onClick={shareLink} className="btn-secondary">
              Copy Link
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (roomId && !isHost) {
    return (
      <div className="room-manager">
        <h3>Connected to room:</h3>
        <code className="room-code">{roomId}</code>
      </div>
    );
  }

  return (
    <div className="room-manager">
      <div className="room-options">
        <div className="option-card">
          <h3>Share a File</h3>
          <p>Create a room and share the ID</p>
          <button onClick={onCreateRoom} className="btn-primary">
            Create Room
          </button>
        </div>
        
        <div className="divider">OR</div>
        
        <div className="option-card">
          <h3>Receive a File</h3>
          <p>Enter the room ID from sender</p>
          <input
            type="text"
            placeholder="Enter room ID"
            value={inputRoomId}
            onChange={(e) => setInputRoomId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
            className="room-input"
          />
          <button onClick={handleJoin} className="btn-primary">
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default RoomManager;