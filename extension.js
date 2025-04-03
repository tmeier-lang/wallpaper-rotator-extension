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
const MIN_CHANGE_DELAY = 5; // seconds

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
        
        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', this._onSettingsActivated.bind(this));
        this.menu.addMenuItem(settingsItem);
    }

    _loadSettings() {
        // In a full implementation, you would load from gsettings
        // For now, we'll use default values
        try {
            const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
            this._wallpaperDir = settings.get_string('wallpaper-directory') || DEFAULT_WALLPAPER_DIR;
            this._interval = settings.get_int('interval') || DEFAULT_INTERVAL;
        } catch (e) {
            log(`Wallpaper Rotator: Error loading settings: ${e.message}`);
        }
    }

    _loadWallpapers() {
        this._wallpapers = [];
        this._currentIndex = 0;
        
        try {
            const dir = Gio.File.new_for_path(this._wallpaperDir);
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
            
            // Try to find current wallpaper in the list
            try {
                const currentWallpaperUri = this._settings.get_string('picture-uri');
                const currentPath = GLib.filename_from_uri(currentWallpaperUri)[0];
                
                const index = this._wallpapers.indexOf(currentPath);
                if (index >= 0) {
                    this._currentIndex = index;
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
        this._statusItem.label.text = `Current: ${basename}`;
    }
    
    _setWallpaper(path) {
        try {
            // Rate limiting check
            const currentTime = GLib.get_monotonic_time() / 1000000;
            if (currentTime - this._lastChangeTime < MIN_CHANGE_DELAY) {
                log(`Wallpaper Rotator: Rate limit - too soon to change wallpaper`);
                return false;
            }
            
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
            
            this._lastChangeTime = currentTime;
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
        this._changeWallpaperRandom();
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
    
    destroy() {
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