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

const SimpleSpeedControl = ({
  onSpeedChange,
  initialSpeed = 0.1,
  isTestingSpeed = false,
  speedTestProgress = '',
  speedTestResults = null,
  onRunSpeedTest
}) => {
  const [speed, setSpeed] = useState(initialSpeed);
  const [inputValue, setInputValue] = useState(initialSpeed.toString());
  const [chunkSizeLabel, setChunkSizeLabel] = useState('64KB');

  // Debug log
  console.log('🎨 SimpleSpeedControl render:', { isTestingSpeed, speedTestProgress, hasTestButton: !!onRunSpeedTest, results: speedTestResults });

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

  // Update speed when initialSpeed changes (e.g., from auto-detection or peer's download speed)
  useEffect(() => {
    if (initialSpeed && initialSpeed > 0 && initialSpeed !== speed) {
      console.log(`🎯 Auto-setting upload speed to: ${initialSpeed} MBps`);
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
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }

          .speed-control-container {
            background: #f5f5f5;
            padding: 15px;
            borderRadius: 8px;
            margin: 10px 0;
            border: 1px solid #ddd;
          }

          @media (max-width: 768px) {
            .speed-control-container {
              padding: 12px;
              margin: 8px 0;
            }

            .speed-control-title {
              font-size: 14px !important;
            }

            .speed-test-button {
              padding: 8px 16px !important;
              font-size: 13px !important;
            }

            .speed-result-box {
              padding: 8px !important;
            }

            .speed-result-value {
              font-size: 18px !important;
            }

            .speed-input-number {
              width: 60px !important;
              font-size: 11px !important;
            }

            .speed-range-text {
              font-size: 9px !important;
            }
          }

          @media (max-width: 480px) {
            .speed-control-container {
              padding: 10px;
              margin: 5px 0;
            }

            .speed-control-title {
              font-size: 13px !important;
            }

            .speed-test-button {
              padding: 6px 12px !important;
              font-size: 12px !important;
            }

            .speed-result-title {
              font-size: 11px !important;
            }

            .speed-result-value {
              font-size: 16px !important;
            }

            .speed-input-label {
              font-size: 12px !important;
            }

            .speed-input-number {
              width: 55px !important;
              font-size: 11px !important;
              padding: 3px 6px !important;
            }

            .speed-range-text {
              font-size: 8px !important;
            }
          }
        `}
      </style>
      <div className="speed-control-container">
      {/* Header with title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '10px'
      }}>
        <span className="speed-control-title" style={{
          fontWeight: '600',
          fontSize: '16px',
          color: '#333'
        }}>
          P2P Connection Test
        </span>
      </div>

      {/* Testing Progress */}
      {isTestingSpeed && (
        <div style={{
          textAlign: 'center',
          marginBottom: '10px'
        }}>
          <span style={{
            background: '#FF9800',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            animation: 'pulse 1.5s ease-in-out infinite',
            display: 'inline-block'
          }}>
            🔄 {speedTestProgress}
          </span>
        </div>
      )}

      {/* Speed Test Button */}
      {onRunSpeedTest && (
        <div style={{
          marginBottom: '10px',
          textAlign: 'center'
        }}>
          <button
            onClick={onRunSpeedTest}
            disabled={isTestingSpeed}
            className="speed-test-button"
            style={{
              padding: '6px 12px',
              borderRadius: '5px',
              border: '1px solid #007bff',
              background: isTestingSpeed ? '#ccc' : '#007bff',
              color: 'white',
              cursor: isTestingSpeed ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
          >
            {isTestingSpeed ? '⏳ Testing...' : '🚀 Test Speed'}
          </button>
        </div>
      )}

      {/* Speed Test Results Display */}
      {speedTestResults && speedTestResults.download > 0 && (
        <div style={{
          background: '#e8f5e9',
          border: '2px solid #4CAF50',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '10px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#2E7D32',
            marginBottom: '8px',
            textAlign: 'center'
          }}>
            📊 Connection Speed
          </div>
          <div className="speed-result-box" style={{
            background: 'white',
            padding: '10px',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            <div className="speed-result-title" style={{ color: '#666', fontSize: '11px', marginBottom: '6px' }}>
              📥 Download Speed from Peer
            </div>
            <div className="speed-result-value" style={{ fontWeight: 'bold', color: '#1976D2', fontSize: '20px', marginBottom: '4px' }}>
              {speedTestResults.download.toFixed(2)} MBps
            </div>
            <div style={{
              fontSize: '13px',
              color: '#FF9800',
              fontWeight: '600',
              background: '#FFF3E0',
              padding: '4px 8px',
              borderRadius: '4px',
              display: 'inline-block'
            }}>
              {(speedTestResults.download * 8).toFixed(1)} Mbps
            </div>
            <div style={{ fontSize: '9px', color: '#999', marginTop: '4px', fontStyle: 'italic' }}>
              (megabits per second)
            </div>
          </div>
        </div>
      )}

      {/* Manual Upload Speed Control */}
      <div style={{
        marginTop: '15px',
        paddingTop: '15px',
        borderTop: '1px solid #ddd'
      }}>
        <div style={{
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <label className="speed-input-label" style={{
            fontSize: '13px',
            color: '#333',
            fontWeight: '600'
          }}>
            Set Upload Speed:
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="number"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              min="0.1"
              max="125"
              step="0.1"
              className="speed-input-number"
              style={{
                width: '70px',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontSize: '12px',
                outline: 'none',
                textAlign: 'center'
              }}
            />
            <span style={{
              fontSize: '12px',
              color: '#666',
              fontWeight: '500'
            }}>
              MBps
            </span>
          </div>
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

        <div className="speed-range-text" style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: '#666'
        }}>
          <span>{sliderMin} MBps</span>
          <span style={{ color: '#999' }}>
            Current: {speed} MBps
          </span>
          <span>{sliderMax} MBps</span>
        </div>

        <div className="speed-range-text" style={{
          marginTop: '8px',
          fontSize: '10px',
          color: '#888',
          textAlign: 'center'
        }}>
          Range: {currentBracket.label} • Chunk: {chunkSizeLabel}
        </div>
      </div>

    </div>
    </>
  );
};

export default SimpleSpeedControl;