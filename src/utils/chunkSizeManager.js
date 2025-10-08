/**
 * Chunk Size Manager
 * Manages dynamic chunk sizes based on upload speed ranges
 */

const CHUNK_SIZE_CONFIG = [
  { minSpeed: 0.1, maxSpeed: 1, chunkSize: 64 * 1024, label: '64KB' },       // 0.1-1 MBps: 64KB chunks
  { minSpeed: 1, maxSpeed: 4, chunkSize: 128 * 1024, label: '128KB' },       // 1-4 MBps: 128KB chunks
  { minSpeed: 4, maxSpeed: 10, chunkSize: 256 * 1024, label: '256KB' },      // 4-10 MBps: 256KB chunks
  { minSpeed: 10, maxSpeed: 25, chunkSize: 512 * 1024, label: '512KB' },     // 10-25 MBps: 512KB chunks
  { minSpeed: 25, maxSpeed: 50, chunkSize: 1024 * 1024, label: '1MB' },      // 25-50 MBps: 1MB chunks
  { minSpeed: 50, maxSpeed: 75, chunkSize: 2 * 1024 * 1024, label: '2MB' },  // 50-75 MBps: 2MB chunks
  { minSpeed: 75, maxSpeed: 100, chunkSize: 3 * 1024 * 1024, label: '3MB' }, // 75-100 MBps: 3MB chunks
  { minSpeed: 100, maxSpeed: 125, chunkSize: 4 * 1024 * 1024, label: '4MB' } // 100-125 MBps: 4MB chunks
];

class ChunkSizeManager {
  constructor() {
    this.currentSpeedMBps = 0.1; // Default speed
    this.currentConfig = this.getConfigForSpeed(0.1);
  }

  /**
   * Get chunk configuration for a given speed
   */
  getConfigForSpeed(speedMBps) {
    for (const config of CHUNK_SIZE_CONFIG) {
      if (speedMBps >= config.minSpeed && speedMBps <= config.maxSpeed) {
        return config;
      }
    }
    // Default to first range if out of bounds
    return CHUNK_SIZE_CONFIG[0];
  }

  /**
   * Update current speed and return new chunk size
   */
  updateSpeed(speedMBps) {
    this.currentSpeedMBps = speedMBps;
    this.currentConfig = this.getConfigForSpeed(speedMBps);
    console.log(`📦 Chunk size updated: ${this.currentConfig.label} for ${speedMBps} MBps`);
    return this.currentConfig.chunkSize;
  }

  /**
   * Get current chunk size in bytes
   */
  getChunkSize() {
    return this.currentConfig.chunkSize;
  }

  /**
   * Get current chunk size label for display
   */
  getChunkSizeLabel() {
    return this.currentConfig.label;
  }

  /**
   * Get speed range for current configuration
   */
  getSpeedRange() {
    return {
      min: this.currentConfig.minSpeed,
      max: this.currentConfig.maxSpeed,
      current: this.currentSpeedMBps
    };
  }

  /**
   * Get slider constraints based on current speed
   * Now returns full range as per requirements
   */
  getSliderConstraints() {
    return {
      min: 0.1,
      max: 125,
      step: this.currentSpeedMBps > 10 ? 1 : 0.1,
      current: this.currentSpeedMBps
    };
  }

  /**
   * Calculate optimal chunk size based on both devices' capabilities
   */
  calculateOptimalChunkSize(uploadSpeed, downloadSpeed) {
    // Use the minimum of upload and download speeds to determine chunk size
    const effectiveSpeed = Math.min(uploadSpeed, downloadSpeed);
    const config = this.getConfigForSpeed(effectiveSpeed);
    return config.chunkSize;
  }
}

export const chunkSizeManager = new ChunkSizeManager();