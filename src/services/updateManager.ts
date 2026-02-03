/**
 * Update Manager Service
 * Handles application version checking and updates via Service Worker
 */

export interface UpdateConfig {
  autoUpdate: boolean;
  checkInterval: number; // minutes
}

export class UpdateManagerService {
  private registration: ServiceWorkerRegistration | null = null;
  private updateAvailable: boolean = false;
  private onUpdateCallback: ((registration: ServiceWorkerRegistration) => void) | null = null;
  private checkIntervalId: NodeJS.Timeout | null = null;

  /**
   * Initialize update manager with service worker registration
   */
  async initialize() {
    if (!('serviceWorker' in navigator)) {
      console.log('Service Worker not supported');
      return;
    }

    try {
      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NEW_VERSION_AVAILABLE') {
          console.log('✨ New version detected from Service Worker:', event.data.version);
          this.updateAvailable = true;
          
          if (this.onUpdateCallback && this.registration) {
            this.onUpdateCallback(this.registration);
          }
        }
      });

      // Listen for service worker updates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('🔄 Controller changed - new version activated');
      });

      // Get existing registration
      this.registration = await navigator.serviceWorker.ready;
      
      // Check if there's a waiting service worker
      if (this.registration.waiting) {
        console.log('⚠️ Update already waiting to be activated');
        this.updateAvailable = true;
        if (this.onUpdateCallback) {
          this.onUpdateCallback(this.registration);
        }
      }
      
      // Listen for new service worker installation
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration!.installing;
        console.log('🔄 New service worker installing...');
        
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('✨ New version installed and waiting');
              this.updateAvailable = true;
              if (this.onUpdateCallback && this.registration) {
                this.onUpdateCallback(this.registration);
              }
            }
          });
        }
      });
      
      console.log('✅ Service Worker ready for update checks');
    } catch (error) {
      console.error('Failed to initialize update manager:', error);
    }
  }

  /**
   * Check for updates manually
   * Only checks if online to preserve offline functionality
   */
  async checkForUpdates(): Promise<boolean> {
    // Only check if online
    if (!navigator.onLine) {
      console.log('⚠️ Offline - skipping update check');
      return false;
    }

    if (!this.registration) {
      await this.initialize();
      if (!this.registration) return false;
    }

    try {
      console.log('🔍 Checking for updates...');
      await this.registration.update();
      return this.updateAvailable;
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return false;
    }
  }

  /**
   * Apply update - skip waiting and reload
   */
  async applyUpdate(): Promise<void> {
    if (!this.registration?.waiting) {
      console.log('⚠️ No update waiting to apply');
      return;
    }

    // Tell waiting service worker to skip waiting and activate
    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // Listen for controller change and reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('🔄 New version activated, reloading...');
      window.location.reload();
    });
  }

  /**
   * Register callback for update notifications
   */
  onUpdateAvailable(callback: () => void) {
    this.onUpdateCallback = (_registration) => callback();
  }

  /**
   * Start periodic update checks
   * @param intervalMinutes - Check interval in minutes
   */
  startPeriodicCheck(intervalMinutes: number = 30) {
    // Clear existing interval
    this.stopPeriodicCheck();

    // Only start if online
    if (!navigator.onLine) {
      console.log('⚠️ Offline - not starting periodic checks');
      return;
    }

    console.log(`⏰ Starting periodic update checks (every ${intervalMinutes} min)`);
    
    // Check immediately
    this.checkForUpdates();

    // Then check periodically
    this.checkIntervalId = setInterval(() => {
      // Only check if online
      if (navigator.onLine) {
        this.checkForUpdates();
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop periodic update checks
   */
  stopPeriodicCheck() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log('⏹️ Stopped periodic update checks');
    }
  }

  /**
   * Check if update is available
   */
  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  /**
   * Load update config from localStorage
   */
  static loadConfig(): UpdateConfig {
    try {
      const saved = localStorage.getItem('updateConfig');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load update config:', error);
    }
    
    // Default config
    return {
      autoUpdate: true, // Auto update enabled by default
      checkInterval: 30 // Check every 30 minutes
    };
  }

  /**
   * Save update config to localStorage
   */
  static saveConfig(config: UpdateConfig) {
    try {
      localStorage.setItem('updateConfig', JSON.stringify(config));
      console.log('✅ Update config saved:', config);
    } catch (error) {
      console.error('Failed to save update config:', error);
    }
  }
}

// Export singleton instance
export const updateManager = new UpdateManagerService();
