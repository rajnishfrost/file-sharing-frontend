import { useState, useEffect } from 'react';
import { adaptiveAgent } from '../utils/SimpleAdaptiveAgent';

// Speed brackets based on chunk size configuration
const SPEED_BRACKETS = [
  { min: 0.1, max: 1, label: '0.1-1 MBps' },
  { min: 1, max: 4, label: '1-4 MBps' },
  { min: 4, max: 10, label: '4-10 MBps' },
  { min: 10, max: 25, label: '10-25 MBps' },
  { min: 25, max: 50, label: '25-50 MBps' },
  { min: 50, max: 75, label: '50-75 MBps' },
  { min: 75, max: 100, label: '75-100 MBps' },
  { min: 100, max: 125, label: '100-125 MBps' }
];

// Get speed bracket for a given speed
const getSpeedBracket = (speedMBps) => {
  for (const bracket of SPEED_BRACKETS) {
    if (speedMBps >= bracket.min && speedMBps <= bracket.max) {
      return bracket;
    }
  }
  // Default to first bracket if out of bounds
  return SPEED_BRACKETS[0];
};

const SimpleSpeedControl = ({ onSpeedChange, initialSpeed = 0.1 }) => {
  const [speed, setSpeed] = useState(initialSpeed);
  const [inputValue, setInputValue] = useState(initialSpeed.toString());
  const [chunkSizeLabel, setChunkSizeLabel] = useState('64KB');

  // Get current speed bracket
  const currentBracket = getSpeedBracket(speed);

  // Slider range constrained to current bracket
  const sliderMin = currentBracket.min;
  const sliderMax = currentBracket.max;
  const sliderStep = speed < 10 ? 0.1 : 1; // Fine control for low speeds

  useEffect(() => {
    // Update chunk size label and input value when speed changes
    setChunkSizeLabel(adaptiveAgent.getChunkSizeLabel());
    setInputValue(speed.toString());
  }, [speed]);

  // Update speed when initialSpeed changes (e.g., from auto-detection)
  useEffect(() => {
    if (initialSpeed && initialSpeed !== 0.1) {
      console.log(`🎯 Auto-detected speed: ${initialSpeed} MBps`);
      setSpeed(initialSpeed);
      onSpeedChange(initialSpeed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpeed]);

  const handleSpeedChange = (newSpeed) => {
    setSpeed(newSpeed);
    onSpeedChange(newSpeed);

    // Update chunk size label after speed change
    setTimeout(() => {
      setChunkSizeLabel(adaptiveAgent.getChunkSizeLabel());
    }, 100);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);

    // Parse and validate input
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0.1 && numValue <= 125) {
      handleSpeedChange(numValue);
    }
  };

  const handleInputBlur = () => {
    // Reset to current speed if invalid
    const numValue = parseFloat(inputValue);
    if (isNaN(numValue) || numValue < 0.1 || numValue > 125) {
      setInputValue(speed.toString());
    }
  };

  return (
    <div style={{
      background: '#f5f5f5',
      padding: '15px',
      borderRadius: '8px',
      margin: '10px 0',
      border: '1px solid #ddd'
    }}>
      {/* Header with title and status badges */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
          <span style={{
            background: '#28a745',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '500'
          }}>
            {chunkSizeLabel}
          </span>
        </div>
      </div>

      {/* Manual speed input */}
      <div style={{
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <label style={{
          fontSize: '12px',
          color: '#555',
          fontWeight: '500'
        }}>
          Set Speed (MBps):
        </label>
        <input
          type="number"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          min="0.1"
          max="125"
          step="0.1"
          style={{
            width: '80px',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            fontSize: '12px',
            outline: 'none'
          }}
        />
        <span style={{
          fontSize: '10px',
          color: '#777',
          fontStyle: 'italic'
        }}>
          Range: {currentBracket.label}
        </span>
      </div>
      
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={speed}
        onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          marginBottom: '8px',
          background: `linear-gradient(to right, 
            #007bff 0%, 
            #007bff ${((speed - sliderMin) / (sliderMax - sliderMin)) * 100}%, 
            #ddd ${((speed - sliderMin) / (sliderMax - sliderMin)) * 100}%, 
            #ddd 100%)`
        }}
      />
      
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: '#666',
        fontWeight: '500'
      }}>
        <span>{sliderMin} MBps</span>
        <span style={{ color: '#999' }}>
          Current: {speed} MBps
        </span>
        <span>{sliderMax} MBps</span>
      </div>

      <div style={{
        marginTop: '8px',
        fontSize: '10px',
        color: '#888',
        textAlign: 'center'
      }}>
        Slider locked to {currentBracket.label} range • Chunk: {chunkSizeLabel}
      </div>
    </div>
  );
};

export default SimpleSpeedControl;