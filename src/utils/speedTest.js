/**
 * Speed Test Utility
 * Tests upload and download speeds between connected peers
 */

const TEST_DURATION = 3000; // 3 seconds per test
const TEST_CHUNK_SIZE = 1024 * 1024; // 1MB chunks for testing

export class SpeedTester {
  constructor(peer) {
    this.peer = peer;
    this.uploadSpeed = 0;
    this.downloadSpeed = 0;
    this.isTestingSpeed = false;
    this.testResults = null;

    // State for download test
    this.downloadTestActive = false;
    this.downloadTestStartTime = null;
    this.downloadTestBytesReceived = 0;
    this.downloadTestResolve = null;
  }

  /**
   * Handle incoming data during speed test
   */
  handleIncomingData(data) {
    if (this.downloadTestActive && (data instanceof ArrayBuffer || data instanceof Uint8Array)) {
      this.downloadTestBytesReceived += data.byteLength || data.length;
    }
  }

  /**
   * Handle speed test control messages
   */
  handleMessage(message) {
    if (message.type === 'speed-test-download-start' && this.downloadTestActive) {
      this.downloadTestStartTime = Date.now();
      this.downloadTestBytesReceived = 0;
      console.log('📥 Starting download speed test...');
    } else if (message.type === 'speed-test-download-end' && this.downloadTestActive) {
      if (this.downloadTestStartTime) {
        const duration = (Date.now() - this.downloadTestStartTime) / 1000;
        const speedMBps = (this.downloadTestBytesReceived / duration) / (1024 * 1024);
        this.downloadSpeed = speedMBps;
        this.downloadTestActive = false;

        if (this.downloadTestResolve) {
          this.downloadTestResolve(speedMBps);
          this.downloadTestResolve = null;
        }
      }
    }
  }

  /**
   * Run complete speed test (both upload and download)
   */
  async runSpeedTest(onProgress) {
    if (this.isTestingSpeed) {
      console.log('⚠️ Speed test already in progress');
      return this.testResults;
    }

    this.isTestingSpeed = true;
    console.log('🚀 Starting speed test...');
    
    try {
      // Notify progress
      if (onProgress) onProgress('Testing upload speed...');
      
      // Test upload speed
      const uploadSpeed = await this.testUploadSpeed();
      
      if (onProgress) onProgress('Testing download speed...');
      
      // Test download speed (request from peer)
      const downloadSpeed = await this.testDownloadSpeed();
      
      this.testResults = {
        upload: uploadSpeed,
        download: downloadSpeed,
        timestamp: Date.now()
      };
      
      console.log(`📊 Speed test complete - Upload: ${uploadSpeed.toFixed(1)} MBps, Download: ${downloadSpeed.toFixed(1)} MBps`);
      
      return this.testResults;
    } finally {
      this.isTestingSpeed = false;
    }
  }

  /**
   * Test upload speed by sending data to peer
   */
  async testUploadSpeed() {
    const testData = new Uint8Array(TEST_CHUNK_SIZE);
    // Fill with random data for more realistic test
    for (let i = 0; i < testData.length; i += 1000) {
      testData[i] = Math.floor(Math.random() * 256);
    }
    
    let bytesSent = 0;
    const startTime = Date.now();
    
    // Send start signal
    this.peer.send(JSON.stringify({
      type: 'speed-test-upload-start',
      duration: TEST_DURATION
    }));
    
    // Send test data for duration
    while (Date.now() - startTime < TEST_DURATION) {
      // Check buffer to avoid overwhelming
      if (this.peer.bufferedAmount < TEST_CHUNK_SIZE * 2) {
        this.peer.send(testData);
        bytesSent += TEST_CHUNK_SIZE;
      }
      // Small delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Send end signal
    this.peer.send(JSON.stringify({
      type: 'speed-test-upload-end',
      bytesSent: bytesSent
    }));
    
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const speedMBps = (bytesSent / duration) / (1024 * 1024); // Convert to MBps
    
    this.uploadSpeed = speedMBps;
    return speedMBps;
  }

  /**
   * Test download speed by receiving data from peer
   */
  async testDownloadSpeed() {
    return new Promise((resolve) => {
      this.downloadTestActive = true;
      this.downloadTestStartTime = null;
      this.downloadTestBytesReceived = 0;
      this.downloadTestResolve = resolve;

      // Request download test from peer
      this.peer.send(JSON.stringify({
        type: 'speed-test-request-download'
      }));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.downloadTestActive) {
          this.downloadTestActive = false;
          this.downloadTestResolve = null;
          resolve(0); // Failed to test
        }
      }, 10000);
    });
  }

  /**
   * Handle speed test messages from peer
   */
  static async handleSpeedTestMessage(message, peer) {
    switch (message.type) {
      case 'speed-test-request-download':
        // Peer wants us to send data for their download test
        console.log('📤 Peer requested download speed test, sending data...');
        
        const testData = new Uint8Array(TEST_CHUNK_SIZE);
        for (let i = 0; i < testData.length; i += 1000) {
          testData[i] = Math.floor(Math.random() * 256);
        }
        
        peer.send(JSON.stringify({
          type: 'speed-test-download-start',
          duration: TEST_DURATION
        }));
        
        const startTime = Date.now();
        let bytesSent = 0;
        
        while (Date.now() - startTime < TEST_DURATION) {
          if (peer.bufferedAmount < TEST_CHUNK_SIZE * 2) {
            peer.send(testData);
            bytesSent += TEST_CHUNK_SIZE;
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        peer.send(JSON.stringify({
          type: 'speed-test-download-end',
          bytesSent: bytesSent
        }));
        
        console.log(`📤 Sent ${(bytesSent / 1024 / 1024).toFixed(1)} MB for download test`);
        break;
        
      case 'speed-test-upload-start':
      case 'speed-test-upload-end':
      case 'speed-test-download-start':
      case 'speed-test-download-end':
        // These are handled by the speed tester itself
        break;
    }
  }
}