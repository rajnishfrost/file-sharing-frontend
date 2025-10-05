import { useState, useRef, useEffect } from 'react';
import SimpleFileApp from './components/SimpleFileApp';
import MaintenanceModal from './components/MaintenanceModal';
import UserCounter from './components/UserCounter';
import healthCheckService from './services/healthCheck';
import './SimpleApp.css';

function SimpleApp() {
  const [isServerHealthy, setIsServerHealthy] = useState(true);
  const [lastHealthCheck, setLastHealthCheck] = useState(null);
  const [serverStats, setServerStats] = useState(null);

  // Health check management
  useEffect(() => {
    // Set up health check listener
    const handleHealthChange = ({ isHealthy, lastCheck, serverStats }) => {
      setIsServerHealthy(isHealthy);
      setLastHealthCheck(lastCheck);
      setServerStats(serverStats);

      if (!isHealthy) {
        console.log('🚨 Server is down - showing maintenance modal');
      } else {
        console.log('✅ Server is back online - hiding maintenance modal');
      }
    };

    // Add listener and start monitoring
    healthCheckService.addListener(handleHealthChange);
    healthCheckService.startMonitoring(60000); // Check every minute when healthy

    // Cleanup on unmount
    return () => {
      healthCheckService.removeListener(handleHealthChange);
      healthCheckService.stopMonitoring();
    };
  }, []);

  // Handle manual retry from maintenance modal
  const handleRetryConnection = async () => {
    console.log('🔄 Manual retry requested...');
    await healthCheckService.forceCheck();
  };

  return (
    <div className="app-container">
      {/* Maintenance Modal - Shows when server is down */}
      <MaintenanceModal
        isVisible={!isServerHealthy}
        onRetry={handleRetryConnection}
        lastCheckTime={lastHealthCheck}
      />

      <div>
        {/* Main Simple File Transfer App */}
        <SimpleFileApp />

        {/* Show health info overlay */}
        <div >
          <UserCounter serverStats={serverStats} />
        </div>
      </div>
    </div>
  );
}

export default SimpleApp;