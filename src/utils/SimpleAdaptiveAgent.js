/**
 * Simple Adaptive Transfer Agent
 * A lightweight agent that can be added to existing WebRTC file transfer
 * to automatically optimize transfer speeds between different devices
 */

class SimpleAdaptiveAgent {
  constructor() {
    // DYNAMIC UPLOAD SPEED STRATEGY - User Configurable Upload, Unlimited Download
    
    // Default upload speed: 0.1 MBps = 104,857.6 bytes per second
    this.uploadTargetSpeed = 0.1 * 1024 * 1024; // 0.1 MBps in bytes/second
    this.uploadSpeedMBps = 0.1; // 0.1 MBps (default)
    
    // Unlimited download speed - no target limit
    this.downloadTargetSpeed = Infinity; // No download limit
    this.downloadSpeedMbps = 'Unlimited'; // No speed cap
    
    // Calculate optimal parameters for current upload speed
    this.uploadChunkSize = 131072; // 128KB chunks (4x larger)
    this.uploadDelay = this.calculateUploadDelay(); // Calculated delay for current speed
    
    // Fixed parameters - no optimization needed
    this.minChunkSize = 131072; // Fixed 128KB
    this.maxChunkSize = 131072; // Fixed 128KB
    this.constantMode = true; // No adaptive changes
    
    // Performance metrics (for display only)
    this.bufferLevel = 0;
    this.lastFeedbackTime = Date.now();
    this.uploadSpeed = this.uploadTargetSpeed;
    this.downloadSpeed = 0;
    this.maxObservedDownloadSpeed = 0;
    this.targetDownloadSpeed = Infinity;
    
    // Speed monitoring (minimal)
    this.speedHistory = [];
    this.maxHistorySize = 5;
    
    // Device detection
    this.deviceType = this.detectDevice();
    console.log(`📱 Device detected: ${this.deviceType} - Using dynamic upload speed (default: ${this.uploadSpeedMBps} MBps), unlimited download`);
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
  
  // Calculate exact delay needed for current upload speed with 128KB chunks
  calculateUploadDelay() {
    const chunksPerSecond = this.uploadTargetSpeed / this.uploadChunkSize;
    const timePerChunk = 1000 / chunksPerSecond; // milliseconds
    const processingOverhead = 6; // estimated processing time
    const requiredDelay = Math.max(10, timePerChunk - processingOverhead); // minimum 10ms
    
    console.log(`🎯 Upload calculated for ${this.uploadSpeedMBps} MBps: ${chunksPerSecond.toFixed(1)} chunks/sec, ${timePerChunk.toFixed(1)}ms per chunk, ${requiredDelay.toFixed(1)}ms delay`);
    console.log(`📊 Download speed: Unlimited (no speed cap on downloads)`);
    return requiredDelay;
  }
  
  // Update upload speed dynamically
  setUploadSpeed(speedMBps) {
    this.uploadSpeedMBps = speedMBps;
    this.uploadTargetSpeed = speedMBps * 1024 * 1024; // Convert to bytes/second
    this.uploadDelay = this.calculateUploadDelay(); // Recalculate delay
    console.log(`⚡ Upload speed updated to: ${speedMBps} MBps (delay: ${this.uploadDelay.toFixed(1)}ms)`);
  }
  
  // Process feedback from receiver - CONSTANT SPEED MODE
  processFeedback(feedback) {
    // Update metrics for display only
    if (feedback.bufferLevel !== undefined) {
      this.bufferLevel = feedback.bufferLevel;
    }
    
    if (feedback.downloadSpeed !== undefined) {
      this.downloadSpeed = feedback.downloadSpeed;
      
      // Add to speed history for display
      this.speedHistory.push(this.downloadSpeed);
      if (this.speedHistory.length > this.maxHistorySize) {
        this.speedHistory.shift();
      }
    }
    
    // CONSTANT MODE - No optimization, just monitoring
    this.lastFeedbackTime = Date.now();
    
    const currentDownloadMbps = (this.downloadSpeed / 1024 / 1024).toFixed(1);
    const bufferChunks = this.bufferLevel;
    
    console.log(`📊 SPEEDS - Upload: ${this.uploadSpeedMBps} MB/s (limited) | Download: ${currentDownloadMbps} MB/s (unlimited) | Buffer: ${bufferChunks} chunks`);
    
    // No parameter changes during transfer - maintain current upload settings
    // Upload parameters remain constant during active transfer
  }
  
  // Reset for new transfer - CONSTANT MODE
  resetForNewTransfer() {
    // Reset basic metrics but keep constant parameters
    this.bufferLevel = 0;
    this.speedHistory = [];
    console.log(`🔄 New transfer starting - Upload limit: ${this.uploadSpeedMBps} MBps, unlimited download`);
  }
  
  // Legacy method compatibility
  maintainOptimalSpeed() {
    // No optimization needed in constant mode
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
  
  // Get current chunk size - CONSTANT 128KB
  getChunkSize() {
    return this.uploadChunkSize; // Always 128KB
  }
  
  // Get current send delay - DYNAMIC based on current speed
  getSendDelay() {
    return Math.floor(this.uploadDelay); // Calculated for current speed
  }
  
  // Check if should apply delay - ALWAYS true for speed control
  shouldDelay() {
    return true; // Always apply delay for speed control
  }
  
  // Update stats for display - CONSTANT SPEED MODE
  getStats() {
    return {
      chunkSize: this.getChunkSize(),
      sendDelay: this.getSendDelay(),
      bufferLevel: this.bufferLevel,
      deviceType: this.deviceType,
      uploadSpeed: this.uploadTargetSpeed, // Current speed setting
      downloadSpeed: this.downloadSpeed,
      maxDownloadSpeed: this.maxObservedDownloadSpeed || Infinity, // No limit
      targetDownloadSpeed: Infinity, // No download limit
      speedEfficiency: '100%', // Always optimal for constant mode
      optimizationActive: false,
      // Constant mode stats
      uploadSpeedMbps: this.uploadSpeedMbps,
      downloadSpeedMbps: this.downloadSpeedMbps,
      constantMode: this.constantMode,
      calculatedDelay: this.uploadDelay.toFixed(1) + 'ms',
      mode: `Upload: ${this.uploadSpeedMBps} MBps (Limited) | Download: Unlimited`
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