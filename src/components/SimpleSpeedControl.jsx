import { useState } from 'react';

const SimpleSpeedControl = ({ onSpeedChange, initialSpeed = 0.1 }) => {
  const [speed, setSpeed] = useState(initialSpeed);

  const handleSpeedChange = (newSpeed) => {
    setSpeed(newSpeed);
    onSpeedChange(newSpeed);
  };

  return (
    <div style={{
      background: '#f5f5f5',
      padding: '15px',
      borderRadius: '8px',
      margin: '10px 0',
      border: '1px solid #ddd'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px'
      }}>
        <span style={{ 
          fontWeight: '600', 
          fontSize: '14px',
          color: '#333'
        }}>
          Upload Speed:
        </span>
        <span style={{
          background: '#007bff',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: '500'
        }}>
          {speed} MBps
        </span>
      </div>
      
      <input
        type="range"
        min="0.1"
        max="2"
        step="0.1"
        value={speed}
        onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          marginBottom: '8px'
        }}
      />
      
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: '#666',
        fontWeight: '500'
      }}>
        <span>0.1</span>
        <span>1.0</span>
        <span>2.0 MBps</span>
      </div>
    </div>
  );
};

export default SimpleSpeedControl;