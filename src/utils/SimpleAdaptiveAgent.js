/**
 * Simple Adaptive Transfer Agent
 * A lightweight agent that can be added to existing WebRTC file transfer
 * to automatically optimize transfer speeds between different devices
 */

class SimpleAdaptiveAgent {
  constructor() {
    // Current transfer parameters - Start high but stable
    this.chunkSize = 65536; // Start with 64KB for good speed + stability
    this.sendDelay = 2; // Small initial delay for stability
    
    // Limits - Balanced for speed and stability
    this.minChunkSize = 16384; // 16KB minimum
    this.maxChunkSize = 131072; // 128KB maximum
    this.maxSendDelay = 50; // Higher max delay for stability
    
    // Performance metrics
    this.bufferLevel = 0;
    this.lastFeedbackTime = Date.now();
    this.uploadSpeed = 0;
    this.downloadSpeed = 0;
    this.maxObservedDownloadSpeed = 0;
    this.targetDownloadSpeed = 0;
    
    // Speed optimization
    this.speedHistory = [];
    this.maxHistorySize = 10;
    this.isOptimizing = true;
    
    // Device detection
    this.deviceType = this.detectDevice();
    console.log(`📱 Device detected: ${this.deviceType} - Starting speed optimization`);
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
    const bufferPressure = Math.min(this.bufferLevel / 25, 1.0); // Use realistic max buffer of 25 chunks
    const speedTrend = this.getSpeedTrend();
    
    // BALANCED SPEED AND STABILITY STRATEGY
    if (bufferPressure > 0.8) {
      // Reduce speed when buffer is getting full (more conservative)
      this.chunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.9);
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 8);
      console.log(`⚠️ High buffer pressure at ${(bufferPressure * 100).toFixed(0)}% - reducing speed for stability`);
    } else if (bufferPressure < 0.4 && speedTrend >= -0.1) {
      // Increase speed when buffer has plenty of room and speed is stable
      if (this.chunkSize < this.maxChunkSize) {
        this.chunkSize = Math.min(this.maxChunkSize, this.chunkSize * 1.1);
        console.log(`🚀 Increasing chunk size: ${this.chunkSize} bytes`);
      }
      if (this.sendDelay > 2) {
        this.sendDelay = Math.max(2, this.sendDelay - 3);
        console.log(`⚡ Reducing delay: ${this.sendDelay}ms`);
      }
      console.log(`🚀 Optimizing speed - buffer: ${(bufferPressure * 100).toFixed(0)}%, chunk: ${this.chunkSize}, delay: ${this.sendDelay}ms`);
    } else if (speedTrend < -0.3) {
      // Speed declining significantly - be more conservative
      this.chunkSize = Math.max(this.minChunkSize, this.chunkSize * 0.95);
      this.sendDelay = Math.min(this.maxSendDelay, this.sendDelay + 5);
      console.log(`📉 Speed declining - backing off for stability (${(this.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s)`);
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
      optimizationActive: this.isOptimizing
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