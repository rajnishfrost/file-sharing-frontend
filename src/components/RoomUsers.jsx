import React from 'react';

const RoomUsers = ({ users, currentUserId, currentUserName, isHost }) => {
  // Ensure current user's name is shown correctly
  const displayUsers = users.map(user => {
    if (user.id === currentUserId) {
      return { ...user, name: currentUserName || user.name };
    }
    return user;
  });
  
  return (
    <div className="room-users">
      <h3>Room Users ({displayUsers.length}/20)</h3>
      <div className="users-list">
        {displayUsers.map(user => {
          const displayName = user.name || `User${user.id.substring(0, 4)}`;
          const isCurrentUser = user.id === currentUserId;
          const isRoomHost = users[0] && user.id === users[0].id; // First user is host
          
          return (
            <div key={user.id} className={`user-item ${isCurrentUser ? 'current-user' : ''}`}>
              <div className="user-avatar">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">
                  {displayName}
                  {isCurrentUser && ' (You)'}
                </span>
                {isRoomHost && (
                  <span className="host-badge">Host</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoomUsers;