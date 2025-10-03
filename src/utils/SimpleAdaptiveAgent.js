/**
 * Simple Adaptive Transfer Agent
 * A lightweight agent that can be added to existing WebRTC file transfer
 * to automatically optimize transfer speeds between different devices
 */

class SimpleAdaptiveAgent {
  constructor() {
    // CONSTANT SPEED STRATEGY - 1 Mbps Upload, 2 Mbps Download
    
    // Fixed upload speed: 1 Mbps = 1,048,576 bytes per second
    this.uploadTargetSpeed = 1 * 1024 * 1024; // 1 Mbps in bytes/second
    this.uploadSpeedMbps = 1; // 1 Mbps
    
    // Fixed download speed target: 2 Mbps = 2,097,152 bytes per second
    this.downloadTargetSpeed = 2 * 1024 * 1024; // 2 Mbps in bytes/second
    this.downloadSpeedMbps = 2; // 2 Mbps
    
    // Calculate optimal parameters for 1 Mbps upload
    this.uploadChunkSize = 32768; // 32KB chunks for smooth 1 Mbps
    this.uploadDelay = this.calculateDelayFor1Mbps(); // Calculated delay for exactly 1 Mbps
    
    // Fixed parameters - no optimization needed
    this.minChunkSize = 32768; // Fixed 32KB
    this.maxChunkSize = 32768; // Fixed 32KB
    this.constantMode = true; // No adaptive changes
    
    // Performance metrics (for display only)
    this.bufferLevel = 0;
    this.lastFeedbackTime = Date.now();
    this.uploadSpeed = this.uploadTargetSpeed;
    this.downloadSpeed = this.downloadTargetSpeed;
    this.maxObservedDownloadSpeed = this.downloadTargetSpeed;
    this.targetDownloadSpeed = this.downloadTargetSpeed;
    
    // Speed monitoring (minimal)
    this.speedHistory = [];
    this.maxHistorySize = 5;
    
    // Device detection
    this.deviceType = this.detectDevice();
    console.log(`📱 Device detected: ${this.deviceType} - Using constant 1 Mbps upload, 2 Mbps download`);
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
  
  // Calculate exact delay needed for 1 Mbps upload with 32KB chunks
  calculateDelayFor1Mbps() {
    // Target: 1 Mbps upload = 1,048,576 bytes/second
    // Chunk size: 32KB = 32,768 bytes
    // Required chunks per second: 1,048,576 / 32,768 = 32 chunks/second
    // Time per chunk: 1000ms / 32 = 31.25ms
    // Accounting for processing overhead (~6ms), delay = 31.25 - 6 = 25.25ms
    
    const chunksPerSecond = this.uploadTargetSpeed / this.uploadChunkSize;
    const timePerChunk = 1000 / chunksPerSecond; // milliseconds
    const processingOverhead = 6; // estimated processing time
    const requiredDelay = Math.max(0, timePerChunk - processingOverhead);
    
    console.log(`🎯 Upload calculated for 1 Mbps: ${chunksPerSecond.toFixed(1)} chunks/sec, ${timePerChunk.toFixed(1)}ms per chunk, ${requiredDelay.toFixed(1)}ms delay`);
    console.log(`📊 Download target: 2 Mbps (receiver will process at this speed)`);
    return requiredDelay;
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
    
    console.log(`📊 CONSTANT SPEEDS - Upload: 1.0 MB/s | Download: ${currentDownloadMbps} MB/s (target: 2.0 MB/s) | Buffer: ${bufferChunks} chunks`);
    
    // No parameter changes - always maintain 1 Mbps upload settings
    // Upload parameters remain constant at 1 Mbps
  }
  
  // Reset for new transfer - CONSTANT MODE
  resetForNewTransfer() {
    // Reset basic metrics but keep constant parameters
    this.bufferLevel = 0;
    this.speedHistory = [];
    console.log(`🔄 New transfer starting - Maintaining 1 Mbps upload, 2 Mbps download target`);
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
  
  // Get current chunk size - CONSTANT 32KB
  getChunkSize() {
    return this.uploadChunkSize; // Always 32KB
  }
  
  // Get current send delay - CONSTANT for 1 Mbps
  getSendDelay() {
    return Math.floor(this.uploadDelay); // Calculated for 1 Mbps
  }
  
  // Check if should apply delay - ALWAYS true for 1 Mbps
  shouldDelay() {
    return true; // Always apply delay for constant 1 Mbps
  }
  
  // Update stats for display - CONSTANT SPEED MODE
  getStats() {
    return {
      chunkSize: this.getChunkSize(),
      sendDelay: this.getSendDelay(),
      bufferLevel: this.bufferLevel,
      deviceType: this.deviceType,
      uploadSpeed: this.uploadTargetSpeed, // Always 1 Mbps
      downloadSpeed: this.downloadSpeed,
      maxDownloadSpeed: this.downloadTargetSpeed, // Target 2 Mbps
      targetDownloadSpeed: this.downloadTargetSpeed, // Always 2 Mbps
      speedEfficiency: '100%', // Always optimal for constant mode
      optimizationActive: false,
      // Constant mode stats
      uploadSpeedMbps: this.uploadSpeedMbps,
      downloadSpeedMbps: this.downloadSpeedMbps,
      constantMode: this.constantMode,
      calculatedDelay: this.uploadDelay.toFixed(1) + 'ms',
      mode: 'Constant Speeds: 1 Mbps Upload, 2 Mbps Download'
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