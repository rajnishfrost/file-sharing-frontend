/**
 * Simple Adaptive Transfer Agent
 * A lightweight agent that can be added to existing WebRTC file transfer
 * to automatically optimize transfer speeds between different devices
 */

class SimpleAdaptiveAgent {
  constructor() {
    // Current transfer parameters - Start conservative for capacity testing
    this.chunkSize = 32768; // Start with 32KB for capacity testing
    this.sendDelay = 5; // Initial delay for testing
    
    // Limits - Wide range for capacity testing
    this.minChunkSize = 8192; // 8KB minimum
    this.maxChunkSize = 262144; // 256KB maximum for testing
    this.maxSendDelay = 100; // Higher max delay for stability
    
    // Performance metrics
    this.bufferLevel = 0;
    this.lastFeedbackTime = Date.now();
    this.uploadSpeed = 0;
    this.downloadSpeed = 0;
    this.maxObservedDownloadSpeed = 0;
    this.targetDownloadSpeed = 0;
    
    // Dynamic capacity testing
    this.capacityTesting = true;
    this.testPhase = 'ramping'; // ramping, stable, optimizing
    this.rampSteps = 0;
    this.maxStableChunkSize = 32768;
    this.maxStableSpeed = 0;
    this.consecutiveStableReadings = 0;
    this.bufferStressTest = false;
    
    // Speed optimization
    this.speedHistory = [];
    this.maxHistorySize = 15;
    this.isOptimizing = true;
    
    // Device detection
    this.deviceType = this.detectDevice();
    console.log(`📱 Device detected: ${this.deviceType} - Starting dynamic capacity testing`);
  }
  
  detectDevice() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('iphone')) return 'iPhone';
    if (userAgent.includes('ipad')) return 'iPad';
    if (userAgent.includes('android')) {
      // Check for specific models if needed
      if (userAgent.includes('sm-')) return 'Samsung';
      return 'Android';
    }
    return 'Desktop';
  }
  
  // Process feedback from receiver and adjust parameters for MAXIMUM speed
  processFeedback(feedback) {
    // Update metrics
    if (feedback.bufferLevel !== undefined) {
      this.bufferLevel = feedback.bufferLevel;
    }
    
    if (feedback.downloadSpeed !== undefined) {
      this.downloadSpeed = feedback.downloadSpeed;
      
      // Track maximum download speed achieved
      if (this.downloadSpeed > this.maxObservedDownloadSpeed) {
        this.maxObservedDownloadSpeed = this.downloadSpeed;
        console.log(`🚀 New max download speed: ${(this.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s`);
      }
      
      // Add to speed history for trend analysis
      this.speedHistory.push(this.downloadSpeed);
      if (this.speedHistory.length > this.maxHistorySize) {
        this.speedHistory.shift();
      }
    }
    
    // Calculate buffer pressure more accurately
    const bufferPressure = Math.min(this.bufferLevel / 20, 1.0); // Use realistic max buffer of 20 chunks
    const speedTrend = this.getSpeedTrend();
    const currentSpeedMbps = this.downloadSpeed / 1024 / 1024;
    
    // DYNAMIC CAPACITY TESTING STRATEGY
    if (this.capacityTesting) {
      this.performCapacityTest(bufferPressure, speedTrend, currentSpeedMbps);
    } else {
      // Use established optimal parameters
      this.maintainOptimalSpeed(bufferPressure, speedTrend, currentSpeedMbps);
    }
    
    // Set target download speed (aim for 90% of max observed)
    this.targetDownloadSpeed = this.maxObservedDownloadSpeed * 0.9;
    
    this.lastFeedbackTime = Date.now();
  }
  
  // Analyze speed trend from recent history
  getSpeedTrend() {
    if (this.speedHistory.length < 3) return 0;
    
    const recent = this.speedHistory.slice(-3);
    const avg1 = recent[0];
    const avg2 = (recent[1] + recent[2]) / 2;
    
    return (avg2 - avg1) / avg1; // Percentage change
  }
  
  // Perform dynamic capacity testing
  performCapacityTest(bufferPressure, speedTrend, currentSpeedMbps) {
    switch (this.testPhase) {
      case 'ramping':
        this.performRampingTest(bufferPressure, speedTrend, currentSpeedMbps);
        break;
      case 'stable':
        this.performStabilityTest(bufferPressure, speedTrend, currentSpeedMbps);
        break;
      case 'optimizing':
        this.performOptimizationTest(bufferPressure, speedTrend, currentSpeedMbps);
        break;
    }
  }
  
  // Phase 1: Gradually increase throughput to find limits
  performRampingTest(bufferPressure, speedTrend, currentSpeedMbps) {
    // If buffer is getting stressed, we found a limit
    if (bufferPressure > 0.7 || speedTrend < -0.2) {
      console.log(`🔍 Capacity limit detected at ${this.chunkSize} bytes, ${currentSpeedMbps.toFixed(1)} MB/s`);
      this.maxStableChunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.8);
      this.maxStableSpeed = this.downloadSpeed * 0.9;
      this.testPhase = 'stable';
      this.consecutiveStableReadings = 0;
      
      // Back off from the limit
      this.chunkSize = this.maxStableChunkSize;
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 10);
      return;
    }
    
    // If connection is stable, keep ramping up
    if (bufferPressure < 0.3 && speedTrend >= -0.1) {
      this.rampSteps++;
      
      if (this.rampSteps % 3 === 0) { // Every 3 feedback cycles
        // Increase chunk size
        if (this.chunkSize < this.maxChunkSize) {
          this.chunkSize = Math.min(this.maxChunkSize, this.chunkSize * 1.25);
          console.log(`🚀 Ramping up: chunk size ${this.chunkSize} bytes`);
        }
        
        // Decrease delay
        if (this.sendDelay > 0) {
          this.sendDelay = Math.max(0, this.sendDelay - 2);
          console.log(`⚡ Ramping up: delay ${this.sendDelay}ms`);
        }
      }
      
      // If we've reached maximum parameters, move to stability testing
      if (this.chunkSize >= this.maxChunkSize && this.sendDelay <= 1) {
        console.log(`📊 Maximum parameters reached, testing stability...`);
        this.testPhase = 'stable';
        this.maxStableChunkSize = this.chunkSize;
        this.maxStableSpeed = this.downloadSpeed;
      }
    }
  }
  
  // Phase 2: Test stability at current parameters
  performStabilityTest(bufferPressure, speedTrend, currentSpeedMbps) {
    // Check if current settings are stable
    if (bufferPressure < 0.6 && speedTrend >= -0.15 && currentSpeedMbps > 0) {
      this.consecutiveStableReadings++;
      
      if (this.consecutiveStableReadings >= 5) {
        console.log(`✅ Stable configuration found: ${this.chunkSize} bytes, ${currentSpeedMbps.toFixed(1)} MB/s`);
        this.testPhase = 'optimizing';
        this.capacityTesting = false; // Move to optimization mode
        this.maxStableChunkSize = this.chunkSize;
        this.maxStableSpeed = this.downloadSpeed;
      }
    } else {
      // Not stable, reduce and test again
      console.log(`⚠️ Instability detected, reducing parameters...`);
      this.chunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.9);
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 5);
      this.consecutiveStableReadings = 0;
      
      // If we've reduced too much, restart ramping
      if (this.chunkSize <= this.minChunkSize * 1.5) {
        console.log(`🔄 Restarting capacity test from lower baseline...`);
        this.testPhase = 'ramping';
        this.rampSteps = 0;
      }
    }
  }
  
  // Phase 3: Fine-tune optimal parameters
  performOptimizationTest(bufferPressure, speedTrend, currentSpeedMbps) {
    // This becomes our normal optimization mode
    this.maintainOptimalSpeed(bufferPressure, speedTrend, currentSpeedMbps);
  }
  
  // Maintain optimal speed using discovered parameters
  maintainOptimalSpeed(bufferPressure, speedTrend, currentSpeedMbps) {
    if (bufferPressure > 0.8) {
      // Emergency brake
      this.chunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.85);
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 10);
      console.log(`🚨 Emergency brake: buffer ${(bufferPressure * 100).toFixed(0)}%`);
    } else if (bufferPressure < 0.3 && speedTrend >= 0) {
      // Gentle optimization towards max stable parameters
      if (this.chunkSize < this.maxStableChunkSize) {
        this.chunkSize = Math.min(this.maxStableChunkSize, this.chunkSize * 1.05);
      }
      if (this.sendDelay > 1) {
        this.sendDelay = Math.max(1, this.sendDelay - 1);
      }
      console.log(`🎯 Optimizing: ${currentSpeedMbps.toFixed(1)} MB/s, chunk: ${this.chunkSize}`);
    } else if (speedTrend < -0.25) {
      // Speed declining, back off slightly
      this.chunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.95);
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 3);
      console.log(`📉 Speed declining, adjusting...`);
    }
  }
  
  // Generate feedback message for sender
  generateFeedback(bytesReceived, chunksInBuffer) {
    const currentSpeed = bytesReceived / ((Date.now() - this.lastFeedbackTime) / 1000);
    
    return {
      type: 'adaptive-feedback',
      bufferLevel: chunksInBuffer,
      downloadSpeed: currentSpeed,
      maxDownloadSpeed: this.maxObservedDownloadSpeed,
      targetSpeed: this.targetDownloadSpeed,
      deviceType: this.deviceType,
      canHandleMore: chunksInBuffer < 25, // Signal if can handle more data
      timestamp: Date.now()
    };
  }
  
  // Get current optimized chunk size
  getChunkSize() {
    return Math.floor(this.chunkSize);
  }
  
  // Get current send delay
  getSendDelay() {
    return Math.floor(this.sendDelay);
  }
  
  // Check if should apply delay
  shouldDelay() {
    return this.sendDelay > 0;
  }
  
  // Update stats for display
  getStats() {
    return {
      chunkSize: this.getChunkSize(),
      sendDelay: this.getSendDelay(),
      bufferLevel: this.bufferLevel,
      deviceType: this.deviceType,
      uploadSpeed: this.uploadSpeed,
      downloadSpeed: this.downloadSpeed,
      maxDownloadSpeed: this.maxObservedDownloadSpeed,
      targetDownloadSpeed: this.targetDownloadSpeed,
      speedEfficiency: this.maxObservedDownloadSpeed > 0 ? 
        (this.downloadSpeed / this.maxObservedDownloadSpeed * 100).toFixed(1) + '%' : '0%',
      optimizationActive: this.isOptimizing,
      // Dynamic capacity testing stats
      capacityTesting: this.capacityTesting,
      testPhase: this.testPhase,
      maxStableChunkSize: this.maxStableChunkSize,
      maxStableSpeed: this.maxStableSpeed,
      rampSteps: this.rampSteps,
      stableReadings: this.consecutiveStableReadings
    };
  }
}

// Export as singleton for easy integration
export const adaptiveAgent = new SimpleAdaptiveAgent();

// Helper function to apply adaptive delay
export async function applyAdaptiveDelay() {
  const delay = adaptiveAgent.getSendDelay();
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Helper to get adaptive chunk size
export function getAdaptiveChunkSize(defaultSize = 16384) {
  return adaptiveAgent.getChunkSize() || defaultSize;
}