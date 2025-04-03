// extension.js - Main extension file
// Added Pango to imports
const { GObject, St, Gio, GLib, Clutter, Pango } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Default configuration
const DEFAULT_INTERVAL = 60; // minutes
const DEFAULT_WALLPAPER_DIR = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);

let wallpaperRotator = null;

const WallpaperRotator = GObject.registerClass(
class WallpaperRotator extends PanelMenu.Button {
    _init() {
        super._init(0.0, "Wallpaper Rotator");

        // Initialize instance variables
        this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
        this._wallpapers = [];
        this._currentIndex = 0;
        this._interval = DEFAULT_INTERVAL;
        this._isRunning = false;
        this._settings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        this._lastChangeTime = 0;
        this._timeout = null;
        this._extensionSettings = null;

        // Load settings from extension preferences (if available)
        this._loadSettings();

        // Create the panel button with icon
        this._icon = new St.Icon({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // Create menu items
        this._createMenu(); // This will now create the updated menu

        // Load wallpapers
        this._loadWallpapers();
    }

    _createMenu() {
        // Clear existing items if recreating menu (good practice)
        this.menu.removeAll();

        // Status item showing current wallpaper
        this._statusItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });

        // *** ADDED: Configure the label for ellipsization ***
        if (this._statusItem.label) { // Ensure the label exists
            this._statusItem.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
        } else {
            log("Wallpaper Rotator: Could not find label on status item to set ellipsize.");
        }
        // *** END OF ADDED BLOCK ***

        this.menu.addMenuItem(this._statusItem); // Add configured item
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Direct Controls Row ---
        const controlsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(controlsItem);

        const controlsBox = new St.BoxLayout({});
        controlsItem.actor.add_child(controlsBox);

        const createControlButton = (iconName, accessibleName, callback) => {
            // Log the icon name being used, especially for debugging the random one
            log(`Wallpaper Rotator: Creating control button with icon: ${iconName}`);
            const icon = new St.Icon({
                icon_name: iconName,
                style_class: 'popup-menu-icon'
            });
            const button = new St.Button({
                child: icon,
                style_class: 'button popup-menu-button',
                can_focus: true,
                reactive: true,
                accessible_name: accessibleName
            });
            button.connect('clicked', callback);
            return button;
        };

        // Previous Button (<)
        const prevButton = createControlButton(
            'media-skip-backward-symbolic',
            'Previous Wallpaper',
            this._onPreviousActivated.bind(this)
        );

        // Next Button (>)
        const nextButton = createControlButton(
            'media-skip-forward-symbolic',
            'Next Wallpaper',
            this._onNextActivated.bind(this)
        );

        // Random Button (?) - *** TRYING 'view-refresh-symbolic' AS A TEST ***
        const randomButtonIcon = 'view-refresh-symbolic'; // Changed from 'media-shuffle-symbolic'
        const randomButton = createControlButton(
            randomButtonIcon,
            'Random Wallpaper',
            this._onRandomActivated.bind(this)
        );

        // Add buttons to the box with spacers for layout: [<  ?  >]
        controlsBox.add_child(prevButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(randomButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(nextButton);

        // --- End of Direct Controls Row ---

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Auto-rotation toggle
        const intervalText = this._interval ? `Every ${this._interval} min` : 'Interval not set';
        this._rotationSwitch = new PopupMenu.PopupSwitchMenuItem(
            `Auto-Rotate (${intervalText})`,
            this._isRunning
        );
        this._rotationSwitch.connect('toggled', this._onRotationToggled.bind(this));
        this.menu.addMenuItem(this._rotationSwitch);

        // Refresh wallpapers item
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Wallpaper List');
        refreshItem.connect('activate', this._onRefreshActivated.bind(this));
        this.menu.addMenuItem(refreshItem);

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', this._onSettingsActivated.bind(this));
        this.menu.addMenuItem(settingsItem);

        // Update the status now that the item exists
        this._updateStatus();
        // Update rotation switch label based on current state/interval
        this._updateRotationSwitchLabel();
    }

    // Helper function to update rotation switch label
    _updateRotationSwitchLabel() {
        if (this._rotationSwitch) {
             const intervalText = (this._interval > 0) ? `${this._interval} min` : 'N/A';
             const stateText = this._isRunning ? `Every ${intervalText}` : `Interval: ${intervalText}`;
             this._rotationSwitch.label.text = `Auto-Rotate (${stateText})`;
        }
    }

    // _loadSettings, _loadWallpapers, _updateStatus, _setWallpaper,
    // _changeWallpaper, _changeWallpaperRandom, _startRotation, _stopRotation,
    // Event Handlers (_onPreviousActivated, etc.), _onSettingsChanged, destroy
    // ... (Keep all the rest of your functions exactly as they were in the previous file) ...
    // ... (No changes needed in the functions below this line based on the request) ...

    _loadSettings() {
        try {
            // Ensure GSettings object is created only once
             if (!this._extensionSettings) {
                 this._extensionSettings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
             }

            // Load directory
            const dirValue = this._extensionSettings.get_string('wallpaper-directory');
            // Use default if setting is empty or null
            this._wallpaperDir = (dirValue && dirValue !== '') ? dirValue : DEFAULT_WALLPAPER_DIR;
            log(`Wallpaper Rotator: Using directory: ${this._wallpaperDir}`);
            // Avoid writing default back immediately if it was already empty

            // Load interval
            this._interval = this._extensionSettings.get_int('interval');
            if (this._interval <= 0) { // Ensure interval is valid
                this._interval = DEFAULT_INTERVAL;
                // Optionally write the default back if the stored value was invalid
                // this._extensionSettings.set_int('interval', this._interval);
            }
            log(`Wallpaper Rotator: Loaded interval setting: ${this._interval}`);

            // Connect to changes only once
            if (!this._settingsChangedId) {
                this._settingsChangedId = this._extensionSettings.connect('changed', this._onSettingsChanged.bind(this));
            }
            // Update switch label after loading settings
             this._updateRotationSwitchLabel();

        } catch (e) {
            log(`Wallpaper Rotator: Error loading settings: ${e.message}`);
            // Fall back to defaults
            this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
            this._interval = DEFAULT_INTERVAL;
            // Update switch label with defaults
            this._updateRotationSwitchLabel();
        }
    }

    _loadWallpapers() {
        log(`Wallpaper Rotator: Loading wallpapers from ${this._wallpaperDir}`);

        this._wallpapers = [];
        this._currentIndex = 0;
        let loadError = null; // Track errors for status update

        try {
            const dir = Gio.File.new_for_path(this._wallpaperDir);

            if (!dir.query_exists(null)) {
                loadError = "Directory not found";
                log(`Wallpaper Rotator: ${loadError}: ${this._wallpaperDir}`);
                // No 'return' here, let finally update status
            } else {
                const enumerator = dir.enumerate_children(
                    'standard::name,standard::type,standard::is-hidden', // Request is-hidden attribute
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );

                const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
                let info;
                while ((info = enumerator.next_file(null))) {
                    // Skip hidden files/folders directly using the attribute
                     if (info.get_is_hidden()) {
                         continue;
                     }

                    const name = info.get_name();
                    const lowerName = name.toLowerCase();

                    if (supportedExtensions.some(ext => lowerName.endsWith(ext))) {
                        this._wallpapers.push(GLib.build_filenamev([this._wallpaperDir, name]));
                    }
                }
                enumerator.close(null); // Close the enumerator when done

                log(`Wallpaper Rotator: Found ${this._wallpapers.length} wallpapers`);

                // Try to find current wallpaper in the list only if wallpapers were found
                if (this._wallpapers.length > 0) {
                    try {
                        const currentWallpaperUri = this._settings.get_string('picture-uri');
                         if (currentWallpaperUri && GLib.uri_is_valid(currentWallpaperUri, GLib.UriFlags.NONE)) {
                            const [success, currentPath] = GLib.filename_from_uri(currentWallpaperUri);
                            if (success && currentPath) {
                                const index = this._wallpapers.indexOf(currentPath);
                                if (index >= 0) {
                                    this._currentIndex = index;
                                    log(`Wallpaper Rotator: Current wallpaper found at index ${index}`);
                                } else {
                                    log(`Wallpaper Rotator: Current wallpaper not found in directory`);
                                }
                            } else {
                                 log(`Wallpaper Rotator: Could not convert current wallpaper URI to path: ${currentWallpaperUri}`);
                            }
                         } else {
                             log(`Wallpaper Rotator: Invalid or empty picture-uri found.`);
                         }
                    } catch (e) {
                        // This error isn't critical for loading the list itself
                        log(`Wallpaper Rotator: Error finding current wallpaper: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            loadError = `Error: ${e.message}`;
            log(`Wallpaper Rotator: Error loading wallpapers: ${e.message}`);
        } finally {
            // Update status based on outcome
            this._updateStatus(loadError); // Pass error message if one occurred
             // If rotation is running, check if it needs stopping/updating
             if (this._isRunning) {
                  if (!this._wallpapers || this._wallpapers.length <= 1) {
                       log("Wallpaper Rotator: Stopping rotation after load - not enough wallpapers.");
                       this._stopRotation();
                       if (this._rotationSwitch) this._rotationSwitch.setToggleState(false);
                  }
             }
             // Ensure switch label is up-to-date
             this._updateRotationSwitchLabel();
        }
    }

    _updateStatus(message = null) {
         // Ensure status item exists before updating
        if (!this._statusItem || !this._statusItem.label) return;

        if (message) {
            this._statusItem.label.text = message; // Display provided message (e.g., error)
            return;
        }

        if (!this._wallpapers || this._wallpapers.length === 0) {
            // Provide more context if possible
             try {
                 const dir = Gio.File.new_for_path(this._wallpaperDir);
                 if (!dir.query_exists(null)) {
                      this._statusItem.label.text = 'Directory not found';
                 } else {
                      this._statusItem.label.text = 'No supported images'; // Shorter message
                 }
             } catch (e) {
                  this._statusItem.label.text = 'Directory error'; // Shorter message
             }
            return;
        }

        // If we have wallpapers, show current one
        if (this._currentIndex >= 0 && this._currentIndex < this._wallpapers.length) {
            const path = this._wallpapers[this._currentIndex];
            const basename = GLib.path_get_basename(path);
            // Make sure label exists before setting text
            if (this._statusItem.label) {
                this._statusItem.label.text = `${basename} (${this._currentIndex + 1}/${this._wallpapers.length})`;
            }
        } else {
             // Handle unexpected index (shouldn't happen with checks)
             if (this._statusItem.label) {
                this._statusItem.label.text = `(${this._wallpapers.length} images)`;
             }
             this._currentIndex = 0; // Reset index if out of bounds
        }
    }

    _setWallpaper(path) {
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null)) {
                log(`Wallpaper Rotator: File not found: ${path}. Removing from list.`);
                // Remove missing file and update status/index
                this._wallpapers.splice(this._currentIndex, 1);
                if (this._currentIndex >= this._wallpapers.length) {
                    this._currentIndex = 0; // Wrap index if needed
                }
                this._updateStatus(`Error: Image file not found`); // Update status
                // Attempt to load next wallpaper? No, let user handle it or timer reschedule.
                return false;
            }

            const uri = file.get_uri();
            log(`Wallpaper Rotator: Setting wallpaper to: ${uri}`);
            this._settings.set_string('picture-uri', uri);
            this._settings.set_string('picture-uri-dark', uri); // Keep dark sync'd

            this._lastChangeTime = GLib.get_monotonic_time() / 1000000;
            this._updateStatus(); // Update status with new filename
            return true;
        } catch (e) {
            log(`Wallpaper Rotator: Error setting wallpaper: ${e.message}`);
            this._updateStatus(`Error setting wallpaper`); // Simpler error message
            return false;
        }
    }

    // Refactored change logic
     _changeWallpaper(newIndex) {
         if (!this._wallpapers || this._wallpapers.length === 0) {
             log("Wallpaper Rotator: No wallpapers loaded, cannot change.");
             return false;
         }
         // Calculate wrapped index
         this._currentIndex = (newIndex % this._wallpapers.length + this._wallpapers.length) % this._wallpapers.length;
         log(`Wallpaper Rotator: Changing wallpaper to index ${this._currentIndex}`);
         return this._setWallpaper(this._wallpapers[this._currentIndex]);
     }

    _changeWallpaperRandom() {
        if (!this._wallpapers || this._wallpapers.length <= 1) {
            log(`Wallpaper Rotator: Only ${this._wallpapers ? this._wallpapers.length : 0} wallpaper(s), not changing randomly`);
            return false;
        }

        const oldIndex = this._currentIndex;
        let newIndex = oldIndex;
        while (newIndex === oldIndex) {
            newIndex = Math.floor(Math.random() * this._wallpapers.length);
        }

        log(`Wallpaper Rotator: Randomly selected index: ${newIndex}`);
        // Directly call _setWallpaper or use _changeWallpaper
        // return this._setWallpaper(this._wallpapers[newIndex]);
        this._currentIndex = newIndex; // Need to update index before _setWallpaper if not using _changeWallpaper
        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }


    _startRotation() {
        if (this._timeout) { // Clear existing timer first
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        if (!this._wallpapers || this._wallpapers.length <= 1) {
            this._updateStatus('Not enough images to rotate');
            this._isRunning = false;
            // Ensure switch reflects the state
            if(this._rotationSwitch) this._rotationSwitch.setToggleState(false);
            this._updateRotationSwitchLabel(); // Update label
            return;
        }

        this._isRunning = true;
        const intervalSeconds = Math.max(1, this._interval) * 60; // Ensure positive interval > 0
        log(`Wallpaper Rotator: Starting rotation, interval: ${intervalSeconds}s`);

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE, // Lower priority for background task
            intervalSeconds,
            () => { // Arrow function preserves 'this'
                if (!this._isRunning) return GLib.SOURCE_REMOVE; // Stop if rotation disabled
                log("Wallpaper Rotator: Timer changing wallpaper");
                this._changeWallpaperRandom();
                return GLib.SOURCE_CONTINUE; // Reschedule
            }
        );

        // Update switch label
        this._updateRotationSwitchLabel();
        // Update status only if needed (e.g., `Auto-rotating every X min` - decided against this)
        // this._updateStatus(`Auto-rotating every ${this._interval} min`);
    }

    _stopRotation() {
        this._isRunning = false; // Set state first

        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
            log("Wallpaper Rotator: Rotation timer stopped");
        }

        // Update switch label and status
        this._updateRotationSwitchLabel();
        this._updateStatus(); // Update status to remove any rotation messages
    }

    // Event handlers
    _onPreviousActivated() {
         this._changeWallpaper(this._currentIndex - 1);
    }

    _onNextActivated() {
         this._changeWallpaper(this._currentIndex + 1);
    }

    _onRandomActivated() {
        // Logic is now inside _changeWallpaperRandom
        this._changeWallpaperRandom();
    }

    _onRefreshActivated() {
        log(`Wallpaper Rotator: Manually refreshing wallpaper list`);
        this._loadWallpapers(); // Reloads, updates status, checks rotation viability
    }

    _onRotationToggled(item, state) {
        log(`Wallpaper Rotator: Rotation toggled via switch to ${state}`);
        if (state) {
            this._startRotation();
        } else {
            this._stopRotation();
        }
    }

    _onSettingsActivated() {
        try {
            ExtensionUtils.openPrefs();
        } catch (e) {
            log(`Wallpaper Rotator: Error opening preferences: ${e.message}`);
        }
    }

    _onSettingsChanged(settings, key) {
        log(`Wallpaper Rotator: Settings changed - ${key}`);

        switch (key) {
            case 'wallpaper-directory':
                // Use the already loaded GSettings object
                const newDir = this._extensionSettings.get_string('wallpaper-directory');
                const effectiveDir = (newDir && newDir !== '') ? newDir : DEFAULT_WALLPAPER_DIR;
                log(`Wallpaper Rotator: Directory setting changed to ${effectiveDir}`);

                if (effectiveDir !== this._wallpaperDir) {
                    this._wallpaperDir = effectiveDir;
                    log(`Wallpaper Rotator: Reloading wallpapers due to directory change.`);
                    this._loadWallpapers(); // Reloads list and handles rotation state
                }
                break;

            case 'interval':
                 // Use the already loaded GSettings object
                const newInterval = this._extensionSettings.get_int('interval');
                log(`Wallpaper Rotator: Interval setting changed to ${newInterval}`);
                if (newInterval > 0 && newInterval !== this._interval) {
                    this._interval = newInterval;
                    this._updateRotationSwitchLabel(); // Update label immediately
                    if (this._isRunning) {
                         // Restart rotation with new interval
                        log("Wallpaper Rotator: Restarting rotation timer with new interval.");
                        this._startRotation(); // Will clear old timer and start new one
                    }
                } else if (newInterval <= 0) {
                     log(`Wallpaper Rotator: Invalid interval ${newInterval} ignored.`);
                     // Optionally reset the setting back to the current valid one
                     // this._extensionSettings.set_int('interval', this._interval);
                }
                break;

            // Keep 'last-action' logic from user's file
            case 'last-action':
                const action = settings.get_string('last-action');
                if (action === 'directory-changed') {
                    // Force reload wallpapers when directory changed signal received
                    log(`Wallpaper Rotator: Received directory-changed action`);
                    this._loadWallpapers();
                }
                break;
        }
    }

    destroy() {
        log("Wallpaper Rotator: Destroying...");
        // Stop any ongoing operations
        this._stopRotation();

        // Disconnect signals
        if (this._extensionSettings && this._settingsChangedId) {
            this._extensionSettings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        // Release references
        this._extensionSettings = null;
        this._settings = null; // Release background settings instance
        this._wallpapers = []; // Clear array

        // Destroy UI elements if needed (usually handled by super.destroy)
        // this.menu.removeAll(); // Let super handle menu destruction

        // Call parent destroy method LAST
        super.destroy();
        log("Wallpaper Rotator: Destroyed.");
    }
});

// Global functions for extension lifecycle
function init(metadata) {
    // Can access metadata like version: metadata.version
    // Good place for translations: ExtensionUtils.initTranslations();
    log(`Initializing Wallpaper Rotator extension v${metadata ? metadata.version : 'N/A'}`);
}

function enable() {
    log(`Enabling Wallpaper Rotator extension`);
     try {
        wallpaperRotator = new WallpaperRotator();
        Main.panel.addToStatusArea('wallpaper-rotator', wallpaperRotator, 1); // Add with index 1 for potential positioning
     } catch(e) {
         // Use logError provided by ExtensionUtils (preferred)
         logError(e, 'Failed to enable Wallpaper Rotator');
         // Clean up if partially created
         if (wallpaperRotator) {
             try { wallpaperRotator.destroy(); } catch (e2) { logError(e2); }
             wallpaperRotator = null;
         }
     }
}

function disable() {
    log(`Disabling Wallpaper Rotator extension`);
    if (wallpaperRotator) {
        // Use try/catch as destroy might fail during shell shutdown sometimes
         try {
            wallpaperRotator.destroy();
         } catch(e) {
             logError(e, 'Error destroying Wallpaper Rotator instance');
         }
        wallpaperRotator = null;
    }
    log(`Wallpaper Rotator extension disabled`);
}