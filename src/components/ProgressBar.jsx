import React from 'react';

const ProgressBar = ({ progress, status }) => {
  const getStatusMessage = () => {
    switch (status) {
      case 'waiting':
        return 'Waiting for peer to connect...';
      case 'connected':
        return 'Connected! Ready to transfer';
      case 'sending':
        return 'Sending file...';
      case 'receiving':
        return 'Receiving file...';
      case 'complete':
        return 'Transfer complete!';
      case 'error':
        return 'Transfer error';
      case 'disconnected':
        return 'Peer disconnected';
      default:
        return 'Ready';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return '#4CAF50';
      case 'error':
      case 'disconnected':
        return '#f44336';
      case 'sending':
      case 'receiving':
        return '#2196F3';
      default:
        return '#9E9E9E';
    }
  };

  return (
    <div className="progress-container">
      <div className="status-message" style={{ color: getStatusColor() }}>
        {getStatusMessage()}
      </div>
      {(status === 'sending' || status === 'receiving') && (
        <>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ 
                width: `${progress}%`,
                backgroundColor: getStatusColor()
              }}
            />
          </div>
          <div className="progress-text">{Math.round(progress)}%</div>
        </>
      )}
    </div>
  );
};

export default ProgressBar;