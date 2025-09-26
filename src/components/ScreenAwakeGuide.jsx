import { useState } from 'react';
import './ScreenAwakeGuide.css';

const ScreenAwakeGuide = () => {
  const [showModal, setShowModal] = useState(false);
  
  // Detect device type and brand
  const getUserDevice = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (/iphone|ipad|ipod/.test(userAgent)) {
      return 'ios';
    } else if (/android/.test(userAgent)) {
      // Try to detect Android brand
      if (/samsung/.test(userAgent)) return 'samsung';
      if (/xiaomi|redmi|poco/.test(userAgent)) return 'xiaomi';
      if (/oneplus/.test(userAgent)) return 'oneplus';
      if (/oppo/.test(userAgent)) return 'oppo';
      if (/vivo/.test(userAgent)) return 'vivo';
      if (/realme/.test(userAgent)) return 'realme';
      if (/huawei/.test(userAgent)) return 'huawei';
      if (/nokia/.test(userAgent)) return 'nokia';
      if (/motorola|moto/.test(userAgent)) return 'motorola';
      if (/pixel/.test(userAgent)) return 'pixel';
      if (/lg/.test(userAgent)) return 'lg';
      return 'android'; // Generic Android
    }
    return 'desktop';
  };

  const getInstructions = () => {
    const device = getUserDevice();
    
    const instructions = {
      ios: {
        title: 'iPhone / iPad',
        icon: '🍎',
        steps: [
          'Open Settings app',
          'Tap "Display & Brightness"',
          'Tap "Auto-Lock"',
          'Select "Never"',
          'Return to this website'
        ],
        note: 'Remember to change it back later to save battery!'
      },
      samsung: {
        title: 'Samsung',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display"',
          'Tap "Screen timeout"',
          'Select "10 minutes" or maximum available',
          'Or use "Smart Stay" if available'
        ],
        alternativeSteps: [
          'Alternative: Pull down notification panel',
          'Look for "Smart Stay" or "Keep screen on" toggle',
          'Enable it while using this app'
        ]
      },
      xiaomi: {
        title: 'Xiaomi / Redmi / POCO',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display" or "Display & Brightness"',
          'Tap "Sleep" or "Screen timeout"',
          'Select "10 minutes" or "Never"'
        ],
        alternativeSteps: [
          'Alternative: Open Settings',
          'Search for "Screen timeout"',
          'Set to maximum duration'
        ]
      },
      oneplus: {
        title: 'OnePlus',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display"',
          'Tap "Screen timeout" or "Auto screen off"',
          'Select "30 minutes" or maximum'
        ]
      },
      oppo: {
        title: 'OPPO',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display & Brightness"',
          'Tap "Auto screen off"',
          'Select "30 minutes" or maximum'
        ]
      },
      vivo: {
        title: 'Vivo',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display & Brightness"',
          'Tap "Screen timeout"',
          'Select "10 minutes" or "Never"'
        ]
      },
      realme: {
        title: 'Realme',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display & Brightness"',
          'Tap "Auto screen off"',
          'Select "30 minutes" or maximum'
        ]
      },
      pixel: {
        title: 'Google Pixel',
        icon: '📱',
        steps: [
          'Open Settings',
          'Tap "Display"',
          'Tap "Screen timeout"',
          'Select "30 minutes"'
        ],
        alternativeSteps: [
          'Alternative: Enable Developer Options',
          'Settings → About Phone → Tap Build Number 7 times',
          'Back to Settings → System → Developer Options',
          'Enable "Stay awake" while charging'
        ]
      },
      android: {
        title: 'Android',
        icon: '🤖',
        steps: [
          'Open Settings',
          'Find "Display" or "Screen"',
          'Look for "Screen timeout", "Sleep", or "Auto-lock"',
          'Select maximum time (10 or 30 minutes)',
          'Return to this website'
        ],
        alternativeSteps: [
          'Tip: Search in Settings',
          'Type "screen timeout" or "sleep"',
          'Select the maximum duration available'
        ]
      },
      desktop: {
        title: 'Desktop',
        icon: '💻',
        steps: [
          'Your screen should stay on automatically',
          'If not, check your system settings:',
          'Windows: Settings → System → Power & Sleep',
          'Mac: System Preferences → Energy Saver',
          'Set "Turn display off" to Never or longer duration'
        ]
      }
    };

    return instructions[device] || instructions.android;
  };

  const deviceInstructions = getInstructions();

  return (
    <>
      <div className="screen-awake-guide">
        <button 
          className="keep-screen-on-btn"
          onClick={() => setShowModal(true)}
          title="Prevent screen from locking"
        >
          <span className="btn-icon">☀️</span>
          <span className="btn-text">Keep Screen On</span>
        </button>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            
            <div className="modal-header">
              <span className="device-icon">{deviceInstructions.icon}</span>
              <h2>Keep Screen Awake</h2>
              <p className="device-name">{deviceInstructions.title}</p>
            </div>

            <div className="instructions-container">
              <h3>Follow these steps:</h3>
              <ol className="steps-list">
                {deviceInstructions.steps.map((step, index) => (
                  <li key={index} className="step-item">
                    <span className="step-number">{index + 1}</span>
                    <span className="step-text">{step}</span>
                  </li>
                ))}
              </ol>

              {deviceInstructions.alternativeSteps && (
                <div className="alternative-section">
                  <h3>Alternative Method:</h3>
                  <ul className="alternative-steps">
                    {deviceInstructions.alternativeSteps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}

              {deviceInstructions.note && (
                <div className="note-section">
                  <p>⚠️ {deviceInstructions.note}</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <p className="help-text">
                This prevents your screen from turning off during file transfers
              </p>
              <button 
                className="done-btn"
                onClick={() => setShowModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ScreenAwakeGuide;