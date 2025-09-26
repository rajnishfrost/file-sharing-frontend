import { useState, useEffect } from 'react';
import './UserCounter.css';

const UserCounter = ({ serverStats }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show the counter after a short delay for smooth animation
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  if (!serverStats) return null;

  const { totalVisitors = 0, activeUsers = 0 } = serverStats;

  return (
    <div className={`user-counter ${isVisible ? 'visible' : ''}`}>
      <div className="counter-content">
        <div className="counter-item">
          <div className="counter-icon">👥</div>
          <div className="counter-details">
            <span className="counter-number">{totalVisitors.toLocaleString()}</span>
            <span className="counter-label">Total Visitors</span>
          </div>
        </div>
        
        <div className="counter-divider"></div>
        
        <div className="counter-item">
          <div className="counter-icon online">🟢</div>
          <div className="counter-details">
            <span className="counter-number">{activeUsers}</span>
            <span className="counter-label">Online Now</span>
          </div>
        </div>
      </div>
      
      <div className="counter-subtitle">
        {activeUsers === 1 ? 
          "You're the only one here" : 
          activeUsers > 1 ? 
            `${activeUsers} users connected` : 
            "Be the first to connect!"
        }
      </div>
    </div>
  );
};

export default UserCounter;