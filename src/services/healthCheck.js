// Health Check Service for Backend Monitoring
class HealthCheckService {
  constructor() {
    this.isHealthy = true;
    this.lastCheckTime = null;
    this.checkInterval = null;
    this.retryInterval = null;
    this.listeners = [];
    this.serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    this.timeoutDuration = 10000; // 10 seconds timeout
    this.sessionId = this.generateSessionId();
    this.hasTrackedVisit = false;
    this.serverStats = null;
    
    console.log('🔗 Health check service using server URL:', this.serverUrl);
  }

  // Generate unique session ID for this browser session
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Add event listener for health status changes
  addListener(callback) {
    this.listeners.push(callback);
  }

  // Remove event listener
  removeListener(callback) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  // Notify all listeners of health status change
  notifyListeners(isHealthy, error = null) {
    this.listeners.forEach(callback => {
      try {
        callback({ 
          isHealthy, 
          error, 
          lastCheck: this.lastCheckTime,
          serverStats: this.serverStats 
        });
      } catch (err) {
        console.error('Error in health check listener:', err);
      }
    });
  }

  // Perform single health check
  async checkHealth() {
    try {
      console.log('🔍 Checking backend health...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutDuration);
      
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        this.lastCheckTime = new Date();
        this.serverStats = {
          totalVisitors: data.totalVisitors,
          activeUsers: data.activeUsers,
          activeRooms: data.activeRooms,
          uptime: data.uptime
        };
        
        if (!this.isHealthy) {
          console.log('✅ Backend is back online!');
          this.isHealthy = true;
          this.stopRetryChecks();
          this.notifyListeners(true);
        } else {
          // Notify listeners with updated stats even when healthy
          this.notifyListeners(true);
        }
        
        return { success: true, data };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
    } catch (error) {
      console.log('❌ Backend health check failed:', error.message);
      this.lastCheckTime = new Date();
      
      if (this.isHealthy) {
        console.log('🚨 Backend appears to be down, starting maintenance mode...');
        this.isHealthy = false;
        this.startRetryChecks();
        this.notifyListeners(false, error.message);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Track user visit
  async trackVisit() {
    if (this.hasTrackedVisit) return;
    
    try {
      const response = await fetch(`${this.serverUrl}/track-visit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        this.hasTrackedVisit = true;
        this.serverStats = {
          totalVisitors: data.totalVisitors,
          activeUsers: data.activeUsers
        };
        console.log('📊 Visit tracked successfully');
        this.notifyListeners(this.isHealthy);
      }
    } catch (error) {
      console.log('Failed to track visit:', error.message);
    }
  }

  // Start continuous health monitoring
  startMonitoring(interval = 60000) { // Default: check every minute
    this.stopMonitoring(); // Clear any existing intervals
    
    console.log('🚀 Starting backend health monitoring...');
    
    // Track visit first
    this.trackVisit();
    
    // Do initial check
    this.checkHealth();
    
    // Set up regular health checks
    this.checkInterval = setInterval(() => {
      this.checkHealth();
    }, interval);
  }

  // Stop health monitoring
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.stopRetryChecks();
  }

  // Start aggressive retry checks when backend is down
  startRetryChecks(interval = 30000) { // Default: retry every 30 seconds
    this.stopRetryChecks(); // Clear any existing retry interval
    
    console.log(`🔄 Starting retry checks every ${interval/1000} seconds...`);
    
    this.retryInterval = setInterval(() => {
      console.log('🔄 Retrying backend connection...');
      this.checkHealth();
    }, interval);
  }

  // Stop retry checks
  stopRetryChecks() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
  }

  // Get current health status
  getStatus() {
    return {
      isHealthy: this.isHealthy,
      lastCheck: this.lastCheckTime,
      isMonitoring: !!this.checkInterval,
      isRetrying: !!this.retryInterval,
      serverStats: this.serverStats
    };
  }

  // Force a health check (useful for manual retry)
  async forceCheck() {
    return await this.checkHealth();
  }
}

// Create singleton instance
const healthCheckService = new HealthCheckService();

export default healthCheckService;