import React, { useState } from 'react';

const UserName = ({ userName, onUpdateName, isConnected, connectedUser }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(userName);

  const handleSave = () => {
    if (tempName.trim()) {
      onUpdateName(tempName.trim());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setTempName(userName);
    setIsEditing(false);
  };

  return (
    <div className="user-info">
      <div className="user-card">
        <div className="user-avatar">
          {userName.charAt(0).toUpperCase()}
        </div>
        <div className="user-details">
          {isEditing ? (
            <div className="edit-name">
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSave()}
                className="name-input"
                maxLength={20}
                autoFocus
              />
              <div className="edit-buttons">
                <button onClick={handleSave} className="btn-save">✓</button>
                <button onClick={handleCancel} className="btn-cancel">✕</button>
              </div>
            </div>
          ) : (
            <div className="display-name">
              <span className="name">You: {userName}</span>
              <button 
                onClick={() => setIsEditing(true)} 
                className="edit-btn"
                title="Edit name"
              >
                ✏️
              </button>
            </div>
          )}
          <span className="status">
            {isConnected ? '🟢 Connected' : '🔴 Not connected'}
          </span>
        </div>
      </div>

      {connectedUser && (
        <div className="user-card connected-user">
          <div className="user-avatar">
            {connectedUser.name.charAt(0).toUpperCase()}
          </div>
          <div className="user-details">
            <span className="name">Connected: {connectedUser.name}</span>
            <span className="status">🟢 Online</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserName;