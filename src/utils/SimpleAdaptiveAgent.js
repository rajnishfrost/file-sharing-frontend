/**
 * Simple Adaptive Transfer Agent
 * A lightweight agent that can be added to existing WebRTC file transfer
 * to automatically optimize transfer speeds between different devices
 */

class SimpleAdaptiveAgent {
  constructor() {
    // SEPARATE parameters for upload and download optimization
    
    // Upload parameters (what I send)
    this.uploadChunkSize = 65536; // Start with 64KB for uploads
    this.uploadDelay = 2; // Minimal delay for uploads
    
    // Download parameters (feedback for sender)
    this.downloadFeedbackOnly = true; // Only provide feedback, don't control upload
    
    // Limits
    this.minChunkSize = 16384; // 16KB minimum
    this.maxChunkSize = 131072; // 128KB maximum  
    this.maxSendDelay = 50; // Max delay
    
    // Performance metrics
    this.bufferLevel = 0;
    this.lastFeedbackTime = Date.now();
    this.uploadSpeed = 0;
    this.downloadSpeed = 0;
    this.maxObservedDownloadSpeed = 0;
    this.targetDownloadSpeed = 0;
    
    // Remove adaptive optimization - use fixed optimal parameters
    this.capacityTesting = false;
    this.isOptimizing = false;
    
    // Speed monitoring only
    this.speedHistory = [];
    this.maxHistorySize = 10;
    
    // Device detection
    this.deviceType = this.detectDevice();
    console.log(`📱 Device detected: ${this.deviceType} - Using fixed optimal parameters`);
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
    
    // SIMPLIFIED - Only track speeds, don't optimize
    // Just update speed tracking for display purposes
    this.lastFeedbackTime = Date.now();
    
    // Only minimal emergency brake if download buffer is completely overwhelmed
    const bufferPressure = Math.min(this.bufferLevel / 15, 1.0);
    if (bufferPressure > 0.95) {
      console.log(`🚨 Emergency: Download buffer completely full (${(bufferPressure * 100).toFixed(0)}%) - temporary pause`);
      // Don't change chunk size, just add minimal delay
      this.uploadDelay = Math.min(10, this.uploadDelay + 5);
    } else if (bufferPressure < 0.2 && this.uploadDelay > 2) {
      // Buffer clear, remove any emergency delays
      this.uploadDelay = Math.max(2, this.uploadDelay - 1);
    }
    
    console.log(`📊 Download: ${(this.downloadSpeed/1024/1024).toFixed(1)}MB/s | Buffer: ${(bufferPressure * 100).toFixed(0)}% | Upload settings: ${this.uploadChunkSize/1024}KB, ${this.uploadDelay}ms`);
  }
  
  // Legacy method - now just returns current stats without optimization
  maintainOptimalSpeed() {
    // No optimization - just monitoring
    
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
    return Math.floor(this.uploadChunkSize);
  }
  
  // Get current send delay
  getSendDelay() {
    return Math.floor(this.uploadDelay);
  }
  
  // Check if should apply delay
  shouldDelay() {
    return this.uploadDelay > 0;
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
      optimizationActive: false,
      mode: 'Fixed Optimal Parameters'
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