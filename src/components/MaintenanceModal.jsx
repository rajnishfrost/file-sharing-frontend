import { useState, useEffect } from 'react';
import './MaintenanceModal.css';

const MaintenanceModal = ({ isVisible, onRetry, lastCheckTime }) => {
  const [timeUntilAvailable, setTimeUntilAvailable] = useState(120); // 2 minutes in seconds
  const [isCountingDown, setIsCountingDown] = useState(true);
  const [nextRetry, setNextRetry] = useState(30); // 30 seconds until next auto-retry

  useEffect(() => {
    if (!isVisible) {
      setTimeUntilAvailable(120);
      setIsCountingDown(true);
      setNextRetry(30);
      return;
    }

    // Main countdown timer (2 minutes)
    const mainTimer = setInterval(() => {
      setTimeUntilAvailable(prev => {
        if (prev <= 1) {
          setIsCountingDown(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Retry countdown timer (30 seconds)
    const retryTimer = setInterval(() => {
      setNextRetry(prev => {
        if (prev <= 1) {
          return 30; // Reset to 30 seconds
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(mainTimer);
      clearInterval(retryTimer);
    };
  }, [isVisible]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusMessage = () => {
    if (isCountingDown) {
      return `The app will be available in ${formatTime(timeUntilAvailable)}`;
    } else {
      return 'The app should be available now. You can try connecting.';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="maintenance-overlay">
      <div className="maintenance-modal">
        <div className="maintenance-header">
          <div className="maintenance-icon">🔧</div>
          <h2>Server Maintenance</h2>
          <p className="maintenance-subtitle">We're working to get things back online</p>
        </div>

        <div className="maintenance-content">
          <div className="status-section">
            <div className="status-indicator">
              <div className="pulse-dot"></div>
              <span>Monitoring server status...</span>
            </div>
            
            <div className="time-display">
              <div className="main-timer">
                <span className="timer-label">Estimated availability:</span>
                <span className={`timer-value ${!isCountingDown ? 'timer-ready' : ''}`}>
                  {isCountingDown ? formatTime(timeUntilAvailable) : 'Available Now'}
                </span>
              </div>
            </div>

            <p className="status-message">{getStatusMessage()}</p>
          </div>

          <div className="retry-section">
            <div className="auto-retry-info">
              <span className="retry-icon">🔄</span>
              <span>Auto-checking every 30 seconds</span>
              <span className="next-retry">Next check in: {nextRetry}s</span>
            </div>
            
            <button 
              className="retry-btn"
              onClick={onRetry}
              disabled={false}
            >
              <span className="retry-btn-icon">⚡</span>
              Try Again Now
            </button>
          </div>

          {lastCheckTime && (
            <div className="last-check">
              <span>Last checked: {lastCheckTime.toLocaleTimeString()}</span>
            </div>
          )}

          <div className="maintenance-info">
            <h3>What's happening?</h3>
            <ul>
              <li>Our server is temporarily unavailable</li>
              <li>We're automatically checking every 30 seconds</li>
              <li>File sharing will resume once the server is back</li>
              <li>No need to refresh the page</li>
            </ul>
          </div>
        </div>

        <div className="maintenance-footer">
          <p>🛡️ Your files and data are safe</p>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceModal;