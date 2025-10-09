/**
 * Speed Test Utility
 * Tests upload and download speeds between connected peers
 */

const TEST_DURATION = 2000; // 2 seconds per test (reduced for mobile stability)
const TEST_CHUNK_SIZE = 64 * 1024; // 64KB chunks for testing (safer for WebRTC)

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
    this.downloadTestOnProgress = null;
  }

  /**
   * Handle peer disconnection during tests
   */
  handlePeerDisconnect() {
    console.log('🔌 SpeedTester detected peer disconnect');

    // Cancel ongoing download test
    if (this.downloadTestActive && this.downloadTestResolve) {
      console.log('⚠️ Cancelling download test due to disconnect');
      this.downloadTestActive = false;
      const resolve = this.downloadTestResolve;
      this.downloadTestResolve = null;
      this.downloadTestOnProgress = null;
      resolve(0); // Return 0 speed for failed test
    }
  }

  /**
   * Handle incoming data during speed test
   */
  handleIncomingData(data) {
    if (this.downloadTestActive && (data instanceof ArrayBuffer || data instanceof Uint8Array)) {
      // Only count data AFTER download test has officially started (after receiving download-start message)
      if (!this.downloadTestStartTime) {
        console.log(`📥 Ignoring ${(data.byteLength || data.length) / 1024} KB - download test not started yet (old buffered data)`);
        return;
      }

      const bytes = data.byteLength || data.length;
      this.downloadTestBytesReceived += bytes;

      console.log(`📥 Received chunk: ${bytes} bytes, total: ${(this.downloadTestBytesReceived / 1024 / 1024).toFixed(2)} MB`);

      // Report progress periodically (every 500ms)
      if (this.downloadTestOnProgress) {
        const now = Date.now();
        if (!this.lastDownloadProgressUpdate || now - this.lastDownloadProgressUpdate >= 500) {
          this.lastDownloadProgressUpdate = now;
          const elapsedSeconds = (now - this.downloadTestStartTime) / 1000;
          if (elapsedSeconds > 0) {
            const currentSpeed = (this.downloadTestBytesReceived / elapsedSeconds) / (1024 * 1024);
            this.downloadTestOnProgress(`Downloading... ${currentSpeed.toFixed(1)} MBps`);
            console.log(`📥 Download speed: ${currentSpeed.toFixed(1)} MBps`);
          }
        }
      }
    }
  }

  /**
   * Handle speed test control messages
   */
  handleMessage(message) {
    console.log(`📨 SpeedTester handleMessage:`, message.type);

    if (message.type === 'speed-test-upload-result') {
      // Peer measured our upload as their download
      const peerDownloadSpeed = message.downloadSpeed;
      console.log(`📊 Peer measured download: ${peerDownloadSpeed.toFixed(2)} MBps (our upload test)`);

      if (this.uploadResultResolve) {
        // Use peer's measurement as it's more accurate
        this.uploadResultResolve(peerDownloadSpeed);
        this.uploadResultResolve = null;
      }
    } else if (message.type === 'speed-test-download-start') {
      console.log(`📥 Got download-start, downloadTestActive: ${this.downloadTestActive}`);
      if (this.downloadTestActive) {
        this.downloadTestStartTime = Date.now();
        this.downloadTestBytesReceived = 0;
        console.log('📥 Download speed test started - ready to receive data');
        if (this.downloadTestOnProgress) {
          this.downloadTestOnProgress('Downloading...');
        }
      }
    } else if (message.type === 'speed-test-download-end' && this.downloadTestActive) {
      if (this.downloadTestStartTime) {
        const duration = (Date.now() - this.downloadTestStartTime) / 1000;
        const downloadSpeedMBps = (this.downloadTestBytesReceived / duration) / (1024 * 1024);
        this.downloadSpeed = downloadSpeedMBps;
        this.downloadTestActive = false;

        const peerUploadSpeed = message.uploadSpeed || downloadSpeedMBps;

        console.log(`📥 Download complete: ${(this.downloadTestBytesReceived / 1024 / 1024).toFixed(1)} MB in ${duration.toFixed(1)}s = ${downloadSpeedMBps.toFixed(2)} MBps`);
        console.log(`📊 Peer upload speed: ${peerUploadSpeed.toFixed(2)} MBps`);

        if (this.downloadTestResolve) {
          this.downloadTestResolve(downloadSpeedMBps);
          this.downloadTestResolve = null;
          this.downloadTestOnProgress = null;
        }
      }
    }
  }

  /**
   * Run speed test (download only to avoid buffer issues)
   */
  async runSpeedTest(onProgress) {
    if (this.isTestingSpeed) {
      console.log('⚠️ Speed test already in progress');
      return this.testResults;
    }

    this.isTestingSpeed = true;
    console.log('🚀 Starting download speed test...');

    try {
      // Skip upload test to avoid buffer overflow issues
      // Only test download speed
      if (onProgress) onProgress('Starting download test...');

      // Test download speed (request from peer)
      const downloadSpeed = await this.testDownloadSpeed(onProgress);

      this.testResults = {
        upload: 0, // Not testing upload to avoid buffer issues
        download: downloadSpeed,
        timestamp: Date.now()
      };

      console.log(`📊 Speed test complete - Download: ${downloadSpeed.toFixed(1)} MBps`);

      return this.testResults;
    } finally {
      this.isTestingSpeed = false;
    }
  }

  /**
   * Test upload speed by sending data to peer
   */
  async testUploadSpeed(onProgress) {
    const testData = new Uint8Array(TEST_CHUNK_SIZE);
    // Fill with random data for more realistic test
    for (let i = 0; i < testData.length; i += 1000) {
      testData[i] = Math.floor(Math.random() * 256);
    }

    let bytesSent = 0;
    const startTime = Date.now();
    let lastProgressUpdate = startTime;

    // Send start signal (check connection first)
    if (!this.peer || !this.peer.connected) {
      console.error('❌ Peer not connected, cannot start upload test');
      return 0;
    }

    try {
      this.peer.send(JSON.stringify({
        type: 'speed-test-upload-start',
        duration: TEST_DURATION
      }));
    } catch (err) {
      console.error('❌ Error sending upload-start signal:', err);
      return 0;
    }

    console.log('📤 Starting upload speed test...');
    console.log(`📤 Peer connection state: ${this.peer.connected ? 'connected' : 'disconnected'}`);
    console.log(`📤 Buffer amount: ${this.peer.bufferedAmount}`);

    // Send test data for duration
    while (Date.now() - startTime < TEST_DURATION) {
      // Check if peer is still connected
      if (!this.peer || !this.peer.connected) {
        console.warn('⚠️ Peer disconnected during upload test');
        break;
      }

      // Check buffer to avoid overwhelming (default to 0 if undefined)
      const bufferAmount = this.peer.bufferedAmount || 0;
      const maxBuffer = TEST_CHUNK_SIZE * 8; // Allow more buffering

      if (bufferAmount < maxBuffer) {
        try {
          this.peer.send(testData);
          bytesSent += TEST_CHUNK_SIZE;
        } catch (err) {
          console.error('❌ Error sending test data:', err);
          // If send fails, stop the test
          break;
        }

        // Report progress every 500ms
        const now = Date.now();
        if (onProgress && now - lastProgressUpdate >= 500) {
          lastProgressUpdate = now;
          const elapsedSeconds = (now - startTime) / 1000;
          if (elapsedSeconds > 0) {
            const currentSpeed = (bytesSent / elapsedSeconds) / (1024 * 1024);
            onProgress(`Uploading... ${currentSpeed.toFixed(1)} MBps`);
            console.log(`📤 Upload progress: ${(bytesSent / 1024 / 1024).toFixed(1)} MB sent in ${elapsedSeconds.toFixed(1)}s = ${currentSpeed.toFixed(1)} MBps`);
          }
        }
      } else {
        // Wait longer when buffer is full
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Small delay to prevent tight loop (increased from 5ms to 10ms for stability)
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`📤 Upload loop finished. Total bytes sent: ${(bytesSent / 1024 / 1024).toFixed(1)} MB`);

    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const uploadSpeedMBps = (bytesSent / duration) / (1024 * 1024); // Convert to MBps

    // Send end signal with our measured upload speed (check connection first)
    if (this.peer && this.peer.connected) {
      try {
        this.peer.send(JSON.stringify({
          type: 'speed-test-upload-end',
          bytesSent: bytesSent,
          uploadSpeed: uploadSpeedMBps
        }));
      } catch (err) {
        console.error('❌ Error sending upload-end signal:', err);
      }
    }

    console.log(`📤 Upload complete: ${(bytesSent / 1024 / 1024).toFixed(1)} MB in ${duration.toFixed(1)}s = ${uploadSpeedMBps.toFixed(2)} MBps`);

    // Wait for peer's download measurement
    return new Promise((resolve) => {
      this.uploadResultResolve = resolve;
      this.uploadSpeed = uploadSpeedMBps;

      // Timeout if peer doesn't respond
      setTimeout(() => {
        if (this.uploadResultResolve) {
          console.log('⚠️ No upload result from peer, using our measurement');
          this.uploadResultResolve = null;
          resolve(uploadSpeedMBps);
        }
      }, 2000);
    });
  }

  /**
   * Test download speed by receiving data from peer
   */
  async testDownloadSpeed(onProgress) {
    return new Promise((resolve) => {
      this.downloadTestActive = true;
      this.downloadTestStartTime = null;
      this.downloadTestBytesReceived = 0;
      this.downloadTestResolve = resolve;
      this.downloadTestOnProgress = onProgress;

      console.log('📥 Requesting download speed test from peer...');

      // Request download test from peer (check connection first)
      if (!this.peer || !this.peer.connected) {
        console.error('❌ Peer not connected, cannot start download test');
        this.downloadTestActive = false;
        resolve(0);
        return;
      }

      try {
        this.peer.send(JSON.stringify({
          type: 'speed-test-request-download'
        }));
      } catch (err) {
        console.error('❌ Error sending download request:', err);
        this.downloadTestActive = false;
        resolve(0);
        return;
      }

      // Timeout after 10 seconds (peer delay + test duration + buffer clearing)
      setTimeout(() => {
        if (this.downloadTestActive) {
          console.log('⚠️ Download speed test timeout');
          this.downloadTestActive = false;
          this.downloadTestResolve = null;
          this.downloadTestOnProgress = null;
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

        // Wait 0.5 seconds before starting
        console.log('⏳ Waiting 0.5 seconds before starting...');
        await new Promise(resolve => setTimeout(resolve, 500));

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
          // Check if peer is still connected
          if (!peer || !peer.connected) {
            console.warn('⚠️ Peer disconnected during download test');
            break;
          }

          const bufferAmount = peer.bufferedAmount || 0;
          const maxBuffer = TEST_CHUNK_SIZE * 8;

          if (bufferAmount < maxBuffer) {
            try {
              peer.send(testData);
              bytesSent += TEST_CHUNK_SIZE;
            } catch (err) {
              console.error('❌ Error sending download test data:', err);
              break;
            }
          } else {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const duration = (Date.now() - startTime) / 1000;
        const uploadSpeedMBps = (bytesSent / duration) / (1024 * 1024);

        if (peer && peer.connected) {
          try {
            peer.send(JSON.stringify({
              type: 'speed-test-download-end',
              bytesSent: bytesSent,
              uploadSpeed: uploadSpeedMBps // I sent at this speed
            }));
          } catch (err) {
            console.error('❌ Error sending download-end signal:', err);
          }
        }

        console.log(`📤 Upload test complete: Sent ${(bytesSent / 1024 / 1024).toFixed(1)} MB in ${duration.toFixed(1)}s = ${uploadSpeedMBps.toFixed(2)} MBps`);
        break;

      case 'speed-test-upload-start':
        // Track received bytes for upload test
        console.log('📥 Received speed-test-upload-start message');
        if (!peer._uploadTestReceiver) {
          peer._uploadTestReceiver = {
            startTime: Date.now(),
            bytesReceived: 0
          };
          console.log('📥 Started upload test receiver - ready to receive data');
        } else {
          console.log('⚠️ Upload test receiver already exists');
        }
        break;

      case 'speed-test-upload-end':
        // Peer finished upload test, report back what we received
        if (peer._uploadTestReceiver) {
          const duration = (Date.now() - peer._uploadTestReceiver.startTime) / 1000;
          const downloadSpeed = (peer._uploadTestReceiver.bytesReceived / duration) / (1024 * 1024);

          console.log(`📥 Download measurement: Received ${(peer._uploadTestReceiver.bytesReceived / 1024 / 1024).toFixed(1)} MB in ${duration.toFixed(1)}s = ${downloadSpeed.toFixed(2)} MBps`);

          // Send back the measured download speed
          peer.send(JSON.stringify({
            type: 'speed-test-upload-result',
            bytesReceived: peer._uploadTestReceiver.bytesReceived,
            downloadSpeed: downloadSpeed, // I received at this speed
            uploadSpeedFromSender: message.uploadSpeed || 0
          }));

          delete peer._uploadTestReceiver;
        }
        break;

      case 'speed-test-download-start':
      case 'speed-test-download-end':
        // These are handled by the speed tester itself
        break;
    }
  }

  /**
   * Track upload test data received by peer
   */
  static handleUploadTestData(peer, data) {
    if (peer._uploadTestReceiver && (data instanceof ArrayBuffer || data instanceof Uint8Array)) {
      const bytes = data.byteLength || data.length;
      peer._uploadTestReceiver.bytesReceived += bytes;
      console.log(`📥 Upload test receiver: got ${bytes} bytes, total: ${(peer._uploadTestReceiver.bytesReceived / 1024 / 1024).toFixed(2)} MB`);
    } else if (peer._uploadTestReceiver) {
      console.log(`⚠️ Upload test receiver active but data type wrong:`, typeof data);
    }
  }
}