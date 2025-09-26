let wakeLock = null;
let noSleepVideo = null;
let wakeLockInterval = null;

// Enhanced wake lock for iOS devices
class NoSleep {
  constructor() {
    this.enabled = false;
    this.video = null;
  }

  enable() {
    if (this.enabled) return Promise.resolve();
    
    return new Promise((resolve) => {
      // Create video element
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.setAttribute('title', 'No Sleep');
      this.video.style.position = 'absolute';
      this.video.style.top = '-10px';
      this.video.style.left = '-10px';
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      
      // Minimal webm video that works on iOS
      const webmSrc = 'data:video/webm;base64,GkXfowEAAAAAAAAfQoaBAUL3gQFC8oEEQvOBCEKChHdlYm1Ch4ECQoWBAhhTgGcBAAAAAAAVkhFNm3RALE27i1OrhBVJqWZTrIHfTbuMU6uEFlSua1OsggEwTbuMU6uEHFO7a1OsghV17AEAAAAAAACkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmAQAAAAAAAEUq17GDD0JATYCNTGF2ZjU2LjQuMTAxV0GDIQ';
      
      // Fallback mp4 video
      const mp4Src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjYwMSBhMGNkN2QzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wAACAAAAAD2WIhAA3//728P4FNjuZQQAAAu5tb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAZAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACGHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAGQAAAAAAAEAAAAAAZBtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAAAEAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAE7bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAA+3N0YmwAAACXc3RzZAAAAAAAAAABAAAAh2F2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAxYXZjQwFkAAr/4QAYZ2QACqzZX4iIhAAAAwAEAAADAFA8SJZYAQAGaOvjyyLAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAAQAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAsUAAAABAAAAFHN0Y28AAAAAAAAAAQAAADAAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjU2LjQwLjEwMQ==';
      
      // Try WebM first (better for Safari), then MP4
      this.video.src = webmSrc;
      this.video.loop = true;
      
      document.body.appendChild(this.video);
      
      const playVideo = () => {
        this.video.play().then(() => {
          this.enabled = true;
          console.log('NoSleep enabled');
          resolve();
        }).catch((err) => {
          // Try MP4 if WebM fails
          this.video.src = mp4Src;
          this.video.play().then(() => {
            this.enabled = true;
            console.log('NoSleep enabled with MP4');
            resolve();
          }).catch(() => {
            console.log('NoSleep video play failed, waiting for user interaction');
            resolve(); // Resolve anyway, will retry on interaction
          });
        });
      };
      
      playVideo();
      
      // Also try on user interaction
      const enableOnInteraction = () => {
        if (!this.enabled) {
          playVideo();
        }
      };
      
      document.addEventListener('touchstart', enableOnInteraction, { once: true });
      document.addEventListener('click', enableOnInteraction, { once: true });
    });
  }
  
  disable() {
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }
    this.enabled = false;
  }
}

const noSleep = new NoSleep();

export const requestWakeLock = async () => {
  try {
    let success = false;
    
    // Method 1: Standard Wake Lock API (not available on iOS Safari)
    if ('wakeLock' in navigator && !navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Standard wake lock acquired');
        
        // Re-acquire on visibility change
        document.addEventListener('visibilitychange', async () => {
          if (wakeLock !== null && document.visibilityState === 'visible') {
            try {
              wakeLock = await navigator.wakeLock.request('screen');
              console.log('Wake lock reacquired');
            } catch (err) {
              console.log('Failed to reacquire wake lock');
            }
          }
        });
        
        success = true;
      } catch (err) {
        console.log('Standard wake lock failed:', err);
      }
    }
    
    // Method 2: NoSleep for iOS/Safari
    if (navigator.userAgent.match(/iPhone|iPad|iPod|Safari/i)) {
      await noSleep.enable();
      success = true;
    }
    
    // Method 3: Refresh interval to keep active
    if (wakeLockInterval) clearInterval(wakeLockInterval);
    wakeLockInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Trigger a small DOM update to keep browser active
        const keepAlive = document.createElement('div');
        keepAlive.style.display = 'none';
        document.body.appendChild(keepAlive);
        setTimeout(() => keepAlive.remove(), 10);
        console.log('Keep alive ping');
      }
    }, 15000); // Every 15 seconds
    
    return success;
  } catch (err) {
    console.error('Wake lock error:', err);
    return false;
  }
};

export const releaseWakeLock = () => {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
  
  if (wakeLockInterval) {
    clearInterval(wakeLockInterval);
    wakeLockInterval = null;
  }
  
  noSleep.disable();
  
  console.log('Wake lock released');
};