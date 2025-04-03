// extension.js - Main extension file
const { GObject, St, Gio, GLib, Clutter } = imports.gi;
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
        this._createMenu();
        
        // Load wallpapers
        this._loadWallpapers();
    }

    _createMenu() {
        // Status item showing current wallpaper
        this._statusItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Controls submenu
        const controlsMenu = new PopupMenu.PopupSubMenuMenuItem('Controls');
        
        // Previous wallpaper
        const prevItem = new PopupMenu.PopupMenuItem('Previous Wallpaper');
        prevItem.connect('activate', this._onPreviousActivated.bind(this));
        controlsMenu.menu.addMenuItem(prevItem);
        
        // Next wallpaper
        const nextItem = new PopupMenu.PopupMenuItem('Next Wallpaper');
        nextItem.connect('activate', this._onNextActivated.bind(this));
        controlsMenu.menu.addMenuItem(nextItem);
        
        // Random wallpaper
        const randomItem = new PopupMenu.PopupMenuItem('Random Wallpaper');
        randomItem.connect('activate', this._onRandomActivated.bind(this));
        controlsMenu.menu.addMenuItem(randomItem);
        
        this.menu.addMenuItem(controlsMenu);
        
        // Auto-rotation toggle
        this._rotationSwitch = new PopupMenu.PopupSwitchMenuItem(
            `Auto-Rotate (Every ${this._interval} min)`,
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
    }

    _loadSettings() {
        try {
            this._extensionSettings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
            
            // Ensure we're getting actual values, not empty defaults
            const dirValue = this._extensionSettings.get_string('wallpaper-directory');
            if (dirValue && dirValue !== '') {
                this._wallpaperDir = dirValue;
                log(`Wallpaper Rotator: Loaded directory setting: ${this._wallpaperDir}`);
            } else {
                this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
                // Save the default value back to settings
                this._extensionSettings.set_string('wallpaper-directory', this._wallpaperDir);
                log(`Wallpaper Rotator: Using default directory: ${this._wallpaperDir}`);
            }
            
            this._interval = this._extensionSettings.get_int('interval') || DEFAULT_INTERVAL;
            log(`Wallpaper Rotator: Loaded interval setting: ${this._interval}`);

            // Connect to changes
            this._settingsChangedId = this._extensionSettings.connect('changed', this._onSettingsChanged.bind(this));
        } catch (e) {
            log(`Wallpaper Rotator: Error loading settings: ${e.message}`);
            // Fall back to defaults
            this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
            this._interval = DEFAULT_INTERVAL;
        }
    }

    _loadWallpapers() {
        log(`Wallpaper Rotator: Loading wallpapers from ${this._wallpaperDir}`);
        
        this._wallpapers = [];
        this._currentIndex = 0;
        
        try {
            const dir = Gio.File.new_for_path(this._wallpaperDir);
            
            if (!dir.query_exists(null)) {
                log(`Wallpaper Rotator: Directory does not exist: ${this._wallpaperDir}`);
                this._updateStatus(`Error: Directory does not exist`);
                return;
            }
            
            const enumerator = dir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            
            // Supported image extensions
            const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
            
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                const lowerName = name.toLowerCase();
                
                if (supportedExtensions.some(ext => lowerName.endsWith(ext))) {
                    this._wallpapers.push(GLib.build_filenamev([this._wallpaperDir, name]));
                }
            }
            
            log(`Wallpaper Rotator: Found ${this._wallpapers.length} wallpapers`);
            
            // Try to find current wallpaper in the list
            try {
                const currentWallpaperUri = this._settings.get_string('picture-uri');
                const currentPath = GLib.filename_from_uri(currentWallpaperUri)[0];
                
                const index = this._wallpapers.indexOf(currentPath);
                if (index >= 0) {
                    this._currentIndex = index;
                    log(`Wallpaper Rotator: Current wallpaper found at index ${index}`);
                } else {
                    log(`Wallpaper Rotator: Current wallpaper not found in directory`);
                }
            } catch (e) {
                log(`Wallpaper Rotator: Error finding current wallpaper: ${e.message}`);
            }
            
            // Update status
            this._updateStatus();
        } catch (e) {
            log(`Wallpaper Rotator: Error loading wallpapers: ${e.message}`);
            this._updateStatus(`Error: ${e.message}`);
        }
    }
    
    _updateStatus(message = null) {
        if (message) {
            this._statusItem.label.text = message;
            return;
        }
        
        if (this._wallpapers.length === 0) {
            this._statusItem.label.text = 'No wallpapers found';
            return;
        }
        
        const path = this._wallpapers[this._currentIndex];
        const basename = GLib.path_get_basename(path);
        this._statusItem.label.text = `Current: ${basename} (${this._currentIndex + 1}/${this._wallpapers.length})`;
    }
    
    _setWallpaper(path) {
        try {
            // Check if file exists
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null)) {
                this._updateStatus(`Error: File not found`);
                return false;
            }
            
            // Convert path to URI
            const uri = file.get_uri();
            
            log(`Wallpaper Rotator: Setting wallpaper to: ${uri}`);
            this._settings.set_string('picture-uri', uri);
            this._settings.set_string('picture-uri-dark', uri);
            
            this._lastChangeTime = GLib.get_monotonic_time() / 1000000;
            this._updateStatus();
            return true;
        } catch (e) {
            log(`Wallpaper Rotator: Error setting wallpaper: ${e.message}`);
            this._updateStatus(`Error: ${e.message}`);
            return false;
        }
    }
    
    _changeWallpaperRandom() {
        if (!this._wallpapers || this._wallpapers.length === 0) {
            return false;
        }
        
        if (this._wallpapers.length === 1) {
            log(`Wallpaper Rotator: Only one wallpaper, not changing randomly`);
            return false;
        }
        
        const oldIndex = this._currentIndex;
        while (this._currentIndex === oldIndex) {
            this._currentIndex = Math.floor(Math.random() * this._wallpapers.length);
        }
        
        log(`Wallpaper Rotator: Randomly selected index: ${this._currentIndex}`);
        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }
    
    _startRotation() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        
        if (!this._wallpapers || this._wallpapers.length <= 1) {
            this._updateStatus('Cannot start: Not enough wallpapers');
            this._isRunning = false;
            this._rotationSwitch.setToggleState(false);
            return;
        }
        
        this._isRunning = true;
        const intervalSeconds = this._interval * 60;
        
        // Schedule first change
        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalSeconds,
            () => {
                if (!this._isRunning) return GLib.SOURCE_REMOVE;
                this._changeWallpaperRandom();
                return GLib.SOURCE_CONTINUE;
            }
        );
        
        this._updateStatus(`Auto-rotating every ${this._interval} minutes`);
    }
    
    _stopRotation() {
        this._isRunning = false;
        
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        
        this._updateStatus();
    }
    
    // Event handlers
    _onPreviousActivated() {
        if (!this._wallpapers || this._wallpapers.length === 0) return;
        
        this._currentIndex = (this._currentIndex - 1 + this._wallpapers.length) % this._wallpapers.length;
        this._setWallpaper(this._wallpapers[this._currentIndex]);
    }
    
    _onNextActivated() {
        if (!this._wallpapers || this._wallpapers.length === 0) return;
        
        this._currentIndex = (this._currentIndex + 1) % this._wallpapers.length;
        this._setWallpaper(this._wallpapers[this._currentIndex]);
    }
    
    _onRandomActivated() {
        if (!this._wallpapers || this._wallpapers.length === 0) {
            log("Wallpaper Rotator: No wallpapers to choose from.");
            return;
        }

        if (this._wallpapers.length === 1) {
            log("Wallpaper Rotator: Only one wallpaper, 'Random' does nothing.");
            // Optionally, still set the wallpaper to ensure consistency,
            // or just return if you prefer 'Random' to do nothing in this case.
            // this._setWallpaper(this._wallpapers[this._currentIndex]); // Optional
            return;
        }
        // *** END OF ADDED CHECK ***

        const oldIndex = this._currentIndex;
        while (this._currentIndex === oldIndex) {
            this._currentIndex = Math.floor(Math.random() * this._wallpapers.length);
        }

        log(`Wallpaper Rotator: Randomly changing wallpaper via menu`); // Added log for clarity
        this._setWallpaper(this._wallpapers[this._currentIndex]);
    }
    
    _onRefreshActivated() {
        log(`Wallpaper Rotator: Manually refreshing wallpaper list`);
        this._loadWallpapers();
    }
    
    _onRotationToggled(item, state) {
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
                const newDir = settings.get_string('wallpaper-directory');
                log(`Wallpaper Rotator: Directory changed to ${newDir}`);
                
                if (newDir !== this._wallpaperDir) {
                    this._wallpaperDir = newDir;
                    // Explicitly reload wallpapers when directory changes
                    this._loadWallpapers();
                }
                break;
                
            case 'interval':
                const newInterval = settings.get_int('interval');
                if (newInterval !== this._interval) {
                    this._interval = newInterval;
                    if (this._isRunning) {
                        this._stopRotation();
                        this._startRotation();
                    }
                    this._rotationSwitch.label.text = `Auto-Rotate (Every ${this._interval} min)`;
                }
                break;
                
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
        // Disconnect settings signal
        if (this._extensionSettings && this._settingsChangedId) {
            this._extensionSettings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        
        this._stopRotation();
        super.destroy();
    }
});

function init() {
    log(`Initializing Wallpaper Rotator extension`);
}

function enable() {
    log(`Enabling Wallpaper Rotator extension`);
    wallpaperRotator = new WallpaperRotator();
    Main.panel.addToStatusArea('wallpaper-rotator', wallpaperRotator);
}

function disable() {
    log(`Disabling Wallpaper Rotator extension`);
    if (wallpaperRotator) {
        wallpaperRotator.destroy();
        wallpaperRotator = null;
    }
}